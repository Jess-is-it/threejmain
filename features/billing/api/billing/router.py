import hashlib
import json
import logging
import os
from contextlib import contextmanager
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from functools import wraps
from math import ceil
from threading import Event, RLock, Thread, local
from typing import Any, Callable, Iterator
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .invoice_pdf import render_invoice_pdf

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


def bounded_env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        logger.warning("Invalid %s; using %s", name, default)
        value = default
    return max(minimum, min(value, maximum))


subscriptions: list[dict[str, Any]] = []
invoices: list[dict[str, Any]] = []
payments: list[dict[str, Any]] = []
credit_applications: list[dict[str, Any]] = []
adjustments: list[dict[str, Any]] = []
installation_charges: list[dict[str, Any]] = []
promotions: list[dict[str, Any]] = []
billing_runs: list[dict[str, Any]] = []

_current_admin: Callable[[str | None], dict[str, Any]] | None = None
_audit_logger: Callable[[str, str, str, dict[str, Any] | None, str], None] | None = None
_customer_resolver: Callable[[str], dict[str, Any]] | None = None
_customer_searcher: Callable[[str], list[dict[str, Any]]] | None = None
_customer_seed: Callable[[], None] | None = None
_sms_sender: Callable[..., dict[str, Any]] | None = None

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
BILLING_RUN_TYPES = ["AUTOMATIC", "MANUAL"]
BILLING_RUN_STATUSES = ["RUNNING", "COMPLETED", "PARTIAL_SUCCESS", "FAILED"]
MONTHLY_INVOICE_TYPES = {"MONTHLY", "FIRST_PRORATED", "FIRST_FULL"}
COLLECTION_PERFORMANCE_STATUSES = {
    "ALL",
    "ACTION_REQUIRED",
    "FULLY_PAID",
    "PARTIALLY_PAID",
    "UNPAID",
}
COLLECTION_WORKLIST_STATUSES = {
    "ALL_OPEN",
    "ACTION_REQUIRED",
    "OVERDUE",
    "PARTIALLY_PAID",
    "UNPAID",
}
COLLECTION_FOLLOW_UP_SMS_SENDER_ID = "3J BILL"
BILLING_RECORD_COLLECTIONS = {
    "subscription": subscriptions,
    "invoice": invoices,
    "payment": payments,
    "credit_application": credit_applications,
    "adjustment": adjustments,
    "installation_charge": installation_charges,
    "promotion": promotions,
    "billing_run": billing_runs,
}
BILLING_STORAGE_MODE = os.getenv("BILLING_STORAGE") or ("postgres" if os.getenv("DATABASE_URL") else "memory")
BILLING_SEED_DEMO = os.getenv("BILLING_SEED_DEMO", "false").strip().lower() in {"1", "true", "yes", "on"}
BILLING_AUTO_BILLER_ENABLED = os.getenv("BILLING_AUTO_BILLER_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}
BILLING_TIMEZONE = os.getenv("BILLING_TIMEZONE", "Asia/Manila").strip() or "Asia/Manila"
BILLING_PREPAID_LEAD_DAYS = bounded_env_int("BILLING_PREPAID_LEAD_DAYS", 7, 0, 31)
BILLING_SCHEDULER_INTERVAL_SECONDS = bounded_env_int("BILLING_SCHEDULER_INTERVAL_SECONDS", 300, 30, 86400)
MAX_BILLING_CATCHUP_CYCLES = 240
DEFAULT_EARLY_BIRD_DISCOUNT = 200.0
ACCOUNT_SUMMARY_SNAPSHOT_VERSION = 1
PAYMENT_PROMOTION_QUOTE_VERSION = 1
OUTAGE_REBATE_QUOTE_VERSION = 2

try:
    BILLING_ZONE = ZoneInfo(BILLING_TIMEZONE)
except ZoneInfoNotFoundError:
    logger.warning("Unknown BILLING_TIMEZONE %s; falling back to UTC", BILLING_TIMEZONE)
    BILLING_TIMEZONE = "UTC"
    BILLING_ZONE = ZoneInfo("UTC")

_billing_scheduler_lock = RLock()
_billing_scheduler_stop = Event()
_billing_scheduler_thread: Thread | None = None
_billing_scheduler_state: dict[str, Any] = {
    "startedAt": "",
    "lastAttemptAt": "",
    "lastCompletedAt": "",
    "lastRunId": "",
    "lastStatus": "",
    "lastError": "",
}


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
    qualifiedPromotionIds: list[str] | None = None
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


class PaymentAllocationPayload(BaseModel):
    invoiceId: str | None = None
    amount: float | None = Field(default=None, gt=0)
    promotionId: str | None = None
    promotionIds: list[str] | None = None
    promotionQuoteDate: str | None = None
    promotionQuoteFingerprint: str | None = None


class PaymentPayload(BaseModel):
    invoiceId: str | None = None
    customerId: str | None = None
    amount: float | None = Field(default=None, gt=0)
    allocations: list[PaymentAllocationPayload] | None = None
    advanceAmount: float | None = Field(default=None, ge=0)
    method: str | None = None
    paymentDate: str | None = None
    referenceNumber: str | None = None
    collectionChannel: str | None = None
    promotionId: str | None = None
    promotionIds: list[str] | None = None
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


class OutageRebatePreviewPayload(BaseModel):
    customerIds: list[str] = Field(default_factory=list, min_length=1, max_length=500)
    outageStart: str
    outageEnd: str


class OutageRebateBatchPayload(OutageRebatePreviewPayload):
    previewFingerprint: str


class CollectionFollowUpSmsPayload(BaseModel):
    messageText: str = Field(..., min_length=1, max_length=500)
    asOf: str | None = None


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


class BillingRunPayload(BaseModel):
    asOf: str | None = None


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
    sms_sender: Callable[..., dict[str, Any]] | None = None,
) -> None:
    global _current_admin, _audit_logger, _customer_resolver, _customer_searcher, _customer_seed, _sms_sender
    _current_admin = current_admin
    _audit_logger = audit_logger
    _customer_resolver = customer_resolver
    _customer_searcher = customer_searcher
    _customer_seed = customer_seed
    _sms_sender = sms_sender


def require_admin(authorization: str | None = Header(default=None)):
    if _current_admin is None:
        raise HTTPException(status_code=500, detail="Billing module is not configured")
    return _current_admin(authorization)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def today_iso() -> str:
    return date.today().isoformat()


def billing_business_date(now: datetime | None = None) -> date:
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return current.astimezone(BILLING_ZONE).date()


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


def posted_payment_day(value: str | None) -> date:
    business_day = billing_business_date()
    payment_day = parse_day(value or business_day.isoformat(), "paymentDate")
    if payment_day > business_day:
        raise HTTPException(status_code=400, detail="Payment date cannot be in the future")
    return payment_day


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


def visible_credit_applications() -> list[dict[str, Any]]:
    ensure_billing_data_loaded()
    return [application for application in credit_applications if not application.get("deletedAt")]


def visible_adjustments() -> list[dict[str, Any]]:
    ensure_billing_data_loaded()
    return [adjustment for adjustment in adjustments if not adjustment.get("deletedAt")]


def visible_installation_charges() -> list[dict[str, Any]]:
    ensure_billing_data_loaded()
    return [charge for charge in installation_charges if not charge.get("deletedAt")]


def visible_promotions() -> list[dict[str, Any]]:
    ensure_billing_data_loaded()
    return [promotion for promotion in promotions if not promotion.get("deletedAt")]


def visible_billing_runs() -> list[dict[str, Any]]:
    ensure_billing_data_loaded()
    return [run for run in billing_runs if not run.get("deletedAt")]


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


def find_billing_run(run_id: str) -> dict[str, Any]:
    return find_row(billing_runs, run_id, "Billing run")


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


def promotion_order_key(promotion: dict[str, Any]) -> tuple[int, str, str]:
    return (
        -promotion_priority(promotion),
        clean_text(promotion.get("promoCode")),
        clean_text(promotion.get("id")),
    )


def normalized_promotion_ids(values: list[Any] | None, field_name: str = "promotionIds") -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values or []:
        promotion_id = clean_text(value)
        if not promotion_id:
            continue
        if promotion_id in seen:
            raise HTTPException(status_code=400, detail=f"Duplicate {field_name} are not allowed")
        seen.add(promotion_id)
        normalized.append(promotion_id)
    return normalized


def promotion_qualification_snapshot(promotion: dict[str, Any], base_amount: float) -> dict[str, Any]:
    return {
        "id": promotion["id"],
        "name": clean_text(promotion.get("name")),
        "promoCode": clean_text(promotion.get("promoCode")),
        "appliesTo": normalize_upper(promotion.get("appliesTo")),
        "discountType": normalize_upper(promotion.get("discountType")),
        "discountAmount": money(promotion.get("discountAmount")),
        "discountPercent": money(promotion.get("discountPercent")),
        "discountAmountForSubscription": promotion_discount_amount(promotion, base_amount),
        "startDate": clean_text(promotion.get("startDate")),
        "endDate": clean_text(promotion.get("endDate")),
        "status": normalize_upper(promotion.get("status") or "ACTIVE"),
        "billingMode": normalize_upper(promotion.get("billingMode") or ""),
        "paymentRule": promotion_payment_rule(promotion),
        "priority": promotion_priority(promotion),
        "requiresApproval": clean_bool(promotion.get("requiresApproval")),
        "stackable": clean_bool(promotion.get("stackable")),
    }


def validate_promotion_stack(promotions_to_stack: list[dict[str, Any]]) -> None:
    if len(promotions_to_stack) <= 1:
        return
    non_stackable = [promotion for promotion in promotions_to_stack if not clean_bool(promotion.get("stackable"))]
    if non_stackable:
        labels = ", ".join(
            clean_text(promotion.get("promoCode") or promotion.get("name") or promotion.get("id"))
            for promotion in non_stackable
        )
        raise HTTPException(
            status_code=400,
            detail=f"Multiple promotions require every selected promotion to be stackable: {labels}",
        )


def promotion_bundle_quote(
    promotions_to_stack: list[dict[str, Any]],
    base_amount: float,
) -> dict[str, Any]:
    ordered = sorted(promotions_to_stack, key=promotion_order_key)
    validate_promotion_stack(ordered)
    remaining = money(base_amount)
    quoted: list[dict[str, Any]] = []
    for promotion in ordered:
        discount_amount = money(min(remaining, promotion_discount_amount(promotion, remaining)))
        if discount_amount <= 0:
            continue
        remaining = money(max(0, remaining - discount_amount))
        quoted.append(
            {
                **promotion,
                "discountBase": money(remaining + discount_amount),
                "discountAmountForInvoice": discount_amount,
                "discountedPayable": remaining,
            }
        )
    return {
        "promotions": quoted,
        "promotionIds": [promotion["id"] for promotion in quoted],
        "discountAmount": money(base_amount - remaining),
        "discountedPayable": remaining,
    }


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
    # Promotion definitions are generic. Customer eligibility is assigned on the
    # subscription or installation-fee decision rather than embedded in the rule.
    record["customerId"] = ""
    record["catalogId"] = ""
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
    if promotion_payment_rule(promotion) not in PROMOTION_PAYMENT_RULES:
        raise HTTPException(status_code=400, detail="Promotion has an invalid payment condition")
    if not promotion_is_active(promotion):
        raise HTTPException(status_code=400, detail="Promotion is not currently active")
    if clean_bool(promotion.get("requiresApproval")):
        raise HTTPException(status_code=400, detail="Approval-required promotions cannot be selected for automatic subscription discounts yet")
    if promotion.get("billingMode") and promotion.get("billingMode") != subscription.get("billingMode"):
        raise HTTPException(status_code=400, detail="Promotion is not valid for this billing mode")


def validate_promotion_for_installation_charge(promotion: dict[str, Any], charge: dict[str, Any]) -> None:
    if promotion.get("appliesTo") != "INSTALLATION_FEE":
        raise HTTPException(status_code=400, detail="Promotion is not valid for installation fees")
    if not promotion_is_active(promotion):
        raise HTTPException(status_code=400, detail="Promotion is not currently active")
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
        "qualifiedPromotionIds",
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
    default_due_days = 0 if record["billingMode"] == "PREPAID" else 7
    record["dueDays"] = int(record.get("dueDays") if record.get("dueDays") is not None else default_due_days)
    legacy_qualification_changed = "earlyBirdEligible" in data or "earlyBirdPromotionId" in data
    if "qualifiedPromotionIds" in data:
        qualified_promotion_ids = normalized_promotion_ids(data.get("qualifiedPromotionIds"), "qualified promotion IDs")
    elif legacy_qualification_changed:
        legacy_promotion_id = clean_text(record.get("earlyBirdPromotionId"))
        qualified_promotion_ids = [legacy_promotion_id] if clean_bool(record.get("earlyBirdEligible")) and legacy_promotion_id else []
    else:
        qualified_promotion_ids = normalized_promotion_ids(record.get("qualifiedPromotionIds"), "qualified promotion IDs")
        if not qualified_promotion_ids:
            legacy_promotion_id = clean_text(record.get("earlyBirdPromotionId"))
            if clean_bool(record.get("earlyBirdEligible")) and legacy_promotion_id:
                qualified_promotion_ids = [legacy_promotion_id]

    qualified_promotions = [find_promotion(promotion_id) for promotion_id in qualified_promotion_ids]
    for promotion in qualified_promotions:
        validate_promotion_for_subscription(promotion, record)
    qualified_promotions.sort(key=promotion_order_key)
    validate_promotion_stack(qualified_promotions)
    if qualified_promotions:
        qualification_quote = promotion_bundle_quote(qualified_promotions, record["monthlyRate"])
        if qualification_quote["discountedPayable"] <= 0:
            raise HTTPException(status_code=400, detail="Combined promotions must leave a payable monthly balance")
    record["qualifiedPromotionIds"] = [promotion["id"] for promotion in qualified_promotions]
    record["qualifiedPromotions"] = [
        promotion_qualification_snapshot(promotion, record["monthlyRate"])
        for promotion in qualified_promotions
    ]
    record["qualifiedPromotionCount"] = len(qualified_promotions)

    early_bird_promotion = next(
        (promotion for promotion in qualified_promotions if promotion_payment_rule(promotion) == "EARLY_BIRD"),
        None,
    )
    record["earlyBirdEligible"] = early_bird_promotion is not None
    record["earlyBirdPromotionId"] = early_bird_promotion["id"] if early_bird_promotion else ""
    record["earlyBirdPromotionCode"] = clean_text(early_bird_promotion.get("promoCode")) if early_bird_promotion else ""
    record["earlyBirdPromotionName"] = clean_text(early_bird_promotion.get("name")) if early_bird_promotion else ""
    record["earlyBirdDiscountAmount"] = (
        promotion_discount_amount(early_bird_promotion, record["monthlyRate"])
        if early_bird_promotion
        else 0
    )
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
    capture_invoice_account_summary_at_issue(invoice)
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
    billing_period_label: str = "",
) -> dict[str, Any]:
    service_ref = subscription.get("serviceId")
    line_description = description or f"{subscription['planName']} monthly internet service"
    if billing_period_label and not description:
        line_description = f"{line_description} ({billing_period_label})"
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


def normalize_line_items(
    items: list[dict[str, Any]] | None,
    subscription: dict[str, Any] | None = None,
    billing_period_label: str = "",
) -> list[dict[str, Any]]:
    if not items and subscription is not None:
        items = [subscription_line_item(subscription, billing_period_label=billing_period_label)]
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


def payment_allocations(payment: dict[str, Any]) -> list[dict[str, Any]]:
    rows = payment.get("allocations") or []
    if rows:
        return rows
    if payment.get("invoiceId"):
        return [
            {
                "invoiceId": payment["invoiceId"],
                "invoiceNumber": payment.get("invoiceNumber", ""),
                "customerId": payment.get("customerId", ""),
                "amount": money(payment.get("amount", 0)),
            }
        ]
    return []


def payment_invoice_ids(payment: dict[str, Any]) -> list[str]:
    invoice_ids: list[str] = []
    for allocation in payment_allocations(payment):
        invoice_id = clean_text(allocation.get("invoiceId"))
        if invoice_id and invoice_id not in invoice_ids:
            invoice_ids.append(invoice_id)
    return invoice_ids


def payment_amount_for_invoice(payment: dict[str, Any], invoice_id: str) -> float:
    return money(
        sum(
            money(allocation.get("amount"))
            for allocation in payment_allocations(payment)
            if allocation.get("invoiceId") == invoice_id
        )
    )


def credit_applications_for_invoice(invoice_id: str) -> list[dict[str, Any]]:
    return [
        application
        for application in visible_credit_applications()
        if application.get("invoiceId") == invoice_id and application.get("status") == "POSTED"
    ]


def credit_applications_for_payment(payment_id: str) -> list[dict[str, Any]]:
    return [
        application
        for application in visible_credit_applications()
        if application.get("sourcePaymentId") == payment_id and application.get("status") == "POSTED"
    ]


def credit_applications_for_adjustment(adjustment_id: str) -> list[dict[str, Any]]:
    return [
        application
        for application in visible_credit_applications()
        if application.get("sourceAdjustmentId") == adjustment_id and application.get("status") == "POSTED"
    ]


def payment_advance_remaining(payment: dict[str, Any]) -> float:
    if payment.get("status") != "POSTED":
        return 0.0
    advance_amount = money(payment.get("advanceAmount"))
    applied_amount = money(sum(row.get("amount") for row in credit_applications_for_payment(payment.get("id") or "")))
    return money(max(0, advance_amount - applied_amount))


def is_customer_account_credit(adjustment: dict[str, Any]) -> bool:
    return (
        adjustment.get("type") == "CREDIT"
        and adjustment.get("applicationMode") == "CUSTOMER_ACCOUNT_CREDIT"
    )


def adjustment_credit_remaining(adjustment: dict[str, Any]) -> float:
    if adjustment.get("status") != "POSTED" or not is_customer_account_credit(adjustment):
        return 0.0
    applied_amount = money(
        sum(row.get("amount") for row in credit_applications_for_adjustment(adjustment.get("id") or ""))
    )
    return money(max(0, money(adjustment.get("amount")) - applied_amount))


def customer_credit_balance(customer_id: str) -> float:
    return money(
        sum(
            payment_advance_remaining(payment)
            for payment in visible_payments()
            if payment.get("customerId") == customer_id and payment.get("status") == "POSTED"
        )
        + sum(
            adjustment_credit_remaining(adjustment)
            for adjustment in visible_adjustments()
            if adjustment.get("customerId") == customer_id
        )
    )


def credit_application_source_adjustment(application: dict[str, Any]) -> dict[str, Any] | None:
    adjustment_id = clean_text(application.get("sourceAdjustmentId"))
    if not adjustment_id:
        return None
    return next(
        (
            adjustment
            for adjustment in visible_adjustments()
            if adjustment.get("id") == adjustment_id
        ),
        None,
    )


def adjustment_summary(adjustment: dict[str, Any]) -> dict[str, Any]:
    row = deepcopy(adjustment)
    if not is_customer_account_credit(adjustment):
        return row
    applications = credit_applications_for_adjustment(adjustment.get("id") or "")
    row["creditAppliedAmount"] = money(sum(application.get("amount") for application in applications))
    row["creditAvailableAmount"] = adjustment_credit_remaining(adjustment)
    row["applicationInvoiceIds"] = [
        application.get("invoiceId")
        for application in applications
        if application.get("invoiceId")
    ]
    row["applicationInvoiceNumbers"] = [
        application.get("invoiceNumber")
        for application in applications
        if application.get("invoiceNumber")
    ]
    return row


def invoice_payments(invoice_id: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for payment in visible_payments():
        if payment["status"] != "POSTED":
            continue
        allocated_amount = payment_amount_for_invoice(payment, invoice_id)
        if allocated_amount <= 0:
            continue
        allocation = next(
            (
                row
                for row in payment_allocations(payment)
                if row.get("invoiceId") == invoice_id and money(row.get("amount")) > 0
            ),
            None,
        )
        rows.append(
            {
                **payment,
                "amount": allocated_amount,
                "allocationAmount": allocated_amount,
                "paymentAmount": money(payment.get("amount", 0)),
                "allocation": allocation or {},
            }
        )
    for application in credit_applications_for_invoice(invoice_id):
        source_payment = next(
            (payment for payment in visible_payments() if payment.get("id") == application.get("sourcePaymentId")),
            {},
        )
        source_adjustment = credit_application_source_adjustment(application) or {}
        rows.append(
            {
                "id": application["id"],
                "receiptNumber": application.get("sourceReceiptNumber") or source_payment.get("receiptNumber") or "",
                "activityLabel": application.get("sourceLabel") or (
                    "Service rebate"
                    if source_adjustment.get("adjustmentSource") == "SERVICE_REBATE"
                    else "Account credit"
                ),
                "customerId": application.get("customerId") or "",
                "amount": money(application.get("amount")),
                "allocationAmount": money(application.get("amount")),
                "paymentAmount": money(source_payment.get("amount")),
                "method": "SERVICE_REBATE" if source_adjustment else "ACCOUNT_CREDIT",
                "paymentDate": application.get("appliedAt") or "",
                "postedAt": application.get("appliedAt") or application.get("createdAt") or "",
                "status": "POSTED",
                "isCreditApplication": True,
                "sourcePaymentId": application.get("sourcePaymentId") or "",
                "sourceAdjustmentId": application.get("sourceAdjustmentId") or "",
                "createdAt": application.get("createdAt") or application.get("appliedAt") or "",
                "allocation": {
                    "invoiceId": invoice_id,
                    "invoiceNumber": application.get("invoiceNumber") or "",
                    "amount": money(application.get("amount")),
                },
            }
        )
    return rows


def payment_invoice_label(allocations: list[dict[str, Any]], advance_amount: float = 0) -> str:
    if not allocations and advance_amount > 0:
        return "Advance credit"
    if len(allocations) == 1:
        label = allocations[0].get("invoiceNumber", "")
    else:
        label = f"{len(allocations)} invoices"
    return f"{label} + advance" if advance_amount > 0 else label


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
    payment_total = money(
        sum(
            payment_amount_for_invoice(payment, invoice["id"])
            for payment in visible_payments()
            if payment.get("status") == "POSTED"
        )
    )
    account_credit_total = money(
        sum(application.get("amount") for application in credit_applications_for_invoice(invoice["id"]))
    )
    paid = money(payment_total + account_credit_total)
    balance = money(max(0, total - paid))
    return {
        "subtotal": subtotal,
        "adjustmentsTotal": adjustment_total,
        "total": total,
        "paymentTotal": payment_total,
        "accountCreditAppliedTotal": account_credit_total,
        "paidTotal": paid,
        "balance": balance,
    }


def invoice_rebate_total(invoice_id: str) -> float:
    direct_rebates = sum(
        adjustment["amount"]
        for adjustment in invoice_adjustments(invoice_id)
        if adjustment.get("adjustmentSource") == "SERVICE_REBATE"
    )
    applied_rebates = sum(
        application.get("amount")
        for application in credit_applications_for_invoice(invoice_id)
        if (
            credit_application_source_adjustment(application) or {}
        ).get("adjustmentSource") == "SERVICE_REBATE"
    )
    return money(direct_rebates + applied_rebates)


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
    current_payment_amount = payment_amount_for_invoice(current_payment, invoice["id"]) if current_payment else 0
    if current_payment_amount > 0 and current_payment.get("status") == "POSTED":
        available_balance = money(available_balance + current_payment_amount)
    if amount > available_balance:
        raise HTTPException(status_code=400, detail="Payment amount cannot exceed invoice balance")
    return summary


def invoice_billing_period(invoice: dict[str, Any]) -> dict[str, str]:
    start_value = clean_text(invoice.get("billingCycleStart") or invoice.get("issueDate"))
    end_value = clean_text(invoice.get("billingCycleEnd") or start_value)
    try:
        start_day = date.fromisoformat(start_value)
        end_day = date.fromisoformat(end_value)
    except ValueError:
        return {
            "billingPeriodMonth": start_value[:7],
            "billingPeriodLabel": start_value[:7],
        }

    same_month = (start_day.year, start_day.month) == (end_day.year, end_day.month)
    label = (
        start_day.strftime("%B %Y")
        if same_month
        else f"{start_day.strftime('%b %Y')} - {end_day.strftime('%b %Y')}"
    )
    return {
        "billingPeriodMonth": start_day.strftime("%Y-%m"),
        "billingPeriodLabel": label,
    }


def invoice_charge_description(
    invoice: dict[str, Any],
    item: dict[str, Any],
    billing_period_label: str,
) -> str:
    description = clean_text(item.get("description")) or "Billing item"
    if invoice.get("invoiceType") not in MONTHLY_INVOICE_TYPES:
        return description

    service_references = list(
        dict.fromkeys(
            clean_text(reference)
            for reference in [item.get("serviceId"), invoice.get("serviceId")]
            if clean_text(reference)
        )
    )
    for service_reference in service_references:
        for suffix in [f" ({service_reference})", f" - {service_reference}"]:
            if description.endswith(suffix):
                description = description[:-len(suffix)].rstrip()
                break

    coverage_start = clean_text(invoice.get("billingCycleStart"))
    coverage_end = clean_text(invoice.get("billingCycleEnd"))
    legacy_coverage_suffix = (
        f" ({coverage_start} to {coverage_end})"
        if coverage_start and coverage_end
        else ""
    )
    if legacy_coverage_suffix and description.endswith(legacy_coverage_suffix):
        description = description[:-len(legacy_coverage_suffix)].rstrip()

    description_has_period = bool(
        billing_period_label
        and billing_period_label.lower() in description.lower()
    )
    if billing_period_label and not description_has_period:
        description = f"{description} ({billing_period_label})"
    return description


def invoice_document_line_items(
    invoice: dict[str, Any],
    billing_period_label: str,
) -> list[dict[str, Any]]:
    return [
        {
            **item,
            "description": invoice_charge_description(invoice, item, billing_period_label),
        }
        for item in invoice.get("lineItems") or []
    ]


def invoice_summary(invoice: dict[str, Any]) -> dict[str, Any]:
    amounts = invoice_amounts(invoice)
    status = derived_invoice_status(invoice, amounts)
    invoice["status"] = status
    billing_period = invoice_billing_period(invoice)
    return {
        **invoice,
        **amounts,
        **billing_period,
        "lineItems": invoice_document_line_items(invoice, billing_period["billingPeriodLabel"]),
        "rebateTotal": invoice_rebate_total(invoice["id"]),
        **invoice_early_bird_details(invoice, amounts),
    }


def invoice_payment_history(invoice_id: str) -> list[dict[str, Any]]:
    history: list[dict[str, Any]] = []
    for payment in visible_payments():
        allocated_amount = payment_amount_for_invoice(payment, invoice_id)
        if allocated_amount <= 0:
            continue
        history.append(
            {
                **deepcopy(payment),
                "amount": allocated_amount,
                "allocationAmount": allocated_amount,
                "paymentAmount": money(payment.get("amount")),
                "isCreditApplication": False,
            }
        )
    for application in visible_credit_applications():
        if application.get("invoiceId") != invoice_id:
            continue
        source_adjustment = credit_application_source_adjustment(application)
        if source_adjustment is not None:
            continue
        source_payment = next(
            (payment for payment in visible_payments() if payment.get("id") == application.get("sourcePaymentId")),
            {},
        )
        history.append(
            {
                "id": application.get("id"),
                "receiptNumber": application.get("sourceReceiptNumber") or source_payment.get("receiptNumber") or "",
                "customerId": application.get("customerId") or "",
                "amount": money(application.get("amount")),
                "allocationAmount": money(application.get("amount")),
                "paymentAmount": money(source_payment.get("amount")),
                "method": "ACCOUNT_CREDIT",
                "paymentDate": application.get("appliedAt") or application.get("createdAt") or "",
                "postedAt": application.get("appliedAt") or application.get("createdAt") or "",
                "referenceNumber": source_payment.get("referenceNumber") or "",
                "collectionChannel": source_payment.get("collectionChannel") or "",
                "status": application.get("status") or "POSTED",
                "isCreditApplication": True,
                "sourcePaymentId": application.get("sourcePaymentId") or "",
                "createdAt": application.get("createdAt") or application.get("appliedAt") or "",
            }
        )
    return sorted(
        history,
        key=lambda row: (
            clean_text(row.get("paymentDate") or row.get("createdAt")),
            clean_text(row.get("receiptNumber") or row.get("id")),
        ),
    )


def invoice_adjustment_history(invoice_id: str) -> list[dict[str, Any]]:
    labels = {
        "SERVICE_REBATE": "Service rebate",
        "PAYMENT_PROMOTION": "Payment promotion",
        "EARLY_BIRD_DISCOUNT": "Early bird discount",
        "MANUAL_ADJUSTMENT": "Manual adjustment",
    }
    history = []
    for adjustment in visible_adjustments():
        if adjustment.get("invoiceId") != invoice_id:
            continue
        source = clean_text(adjustment.get("adjustmentSource"))
        history.append(
            {
                **deepcopy(adjustment),
                "adjustmentLabel": labels.get(source, source.replace("_", " ").title() if source else "Adjustment"),
            }
        )
    for application in credit_applications_for_invoice(invoice_id):
        source_adjustment = credit_application_source_adjustment(application)
        if source_adjustment is None:
            continue
        source = clean_text(source_adjustment.get("adjustmentSource"))
        history.append(
            {
                **deepcopy(source_adjustment),
                "id": application["id"],
                "sourceAdjustmentId": source_adjustment["id"],
                "invoiceId": invoice_id,
                "invoiceNumber": application.get("invoiceNumber") or "",
                "amount": money(application.get("amount")),
                "status": application.get("status") or "POSTED",
                "createdAt": application.get("appliedAt") or application.get("createdAt") or "",
                "isCreditApplication": True,
                "adjustmentLabel": labels.get(
                    source,
                    source.replace("_", " ").title() if source else "Account credit",
                ),
            }
        )
    return sorted(
        history,
        key=lambda row: (
            clean_text(row.get("createdAt")),
            clean_text(row.get("id")),
        ),
    )


def invoice_detail(invoice: dict[str, Any]) -> dict[str, Any]:
    return {
        **invoice_summary(invoice),
        "accountSummaryAtIssue": (
            deepcopy(invoice.get("accountSummaryAtIssue"))
            if isinstance(invoice.get("accountSummaryAtIssue"), dict)
            else None
        ),
        "payments": invoice_payment_history(invoice["id"]),
        "adjustments": invoice_adjustment_history(invoice["id"]),
    }


def parse_record_moment(value: Any) -> datetime | None:
    text = clean_text(value)
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def record_moment(record: dict[str, Any], *field_names: str) -> datetime | None:
    for field_name in field_names:
        parsed = parse_record_moment(record.get(field_name))
        if parsed is not None:
            return parsed
    return None


def moment_is_in_window(moment: datetime | None, start: datetime | None, end: datetime) -> bool:
    if moment is None:
        return False
    return (start is None or moment > start) and moment <= end


def previous_open_invoice_snapshot(invoice: dict[str, Any], as_of: date) -> dict[str, Any] | None:
    summary = invoice_summary(invoice)
    if summary.get("status") in {"DRAFT", "PAID", "VOID"} or money(summary.get("balance")) <= 0:
        return None
    due_day = parse_day(summary.get("dueDate"), "dueDate")
    days_overdue = max(0, (as_of - due_day).days)
    status_at_issue = (
        "PARTIALLY_PAID"
        if money(summary.get("paidTotal")) > 0
        else "OVERDUE"
        if days_overdue > 0
        else "ISSUED"
    )
    posted_adjustments = invoice_adjustments(invoice["id"])
    credit_adjustments = money(
        sum(adjustment.get("amount") for adjustment in posted_adjustments if adjustment.get("type") == "CREDIT")
    )
    debit_adjustments = money(
        sum(adjustment.get("amount") for adjustment in posted_adjustments if adjustment.get("type") == "DEBIT")
    )
    return {
        "invoiceId": summary["id"],
        "invoiceNumber": summary.get("invoiceNumber") or "",
        "invoiceType": summary.get("invoiceType") or "",
        "billingPeriodMonth": summary.get("billingPeriodMonth") or "",
        "billingPeriodLabel": summary.get("billingPeriodLabel") or "",
        "billingCycleStart": summary.get("billingCycleStart") or "",
        "billingCycleEnd": summary.get("billingCycleEnd") or "",
        "issueDate": summary.get("issueDate") or "",
        "dueDate": summary.get("dueDate") or "",
        "statusAtIssue": status_at_issue,
        "isOverdueAtIssue": days_overdue > 0,
        "daysOverdueAtIssue": days_overdue,
        "invoiceTotalAtIssue": money(summary.get("total")),
        "paidTotalAtIssue": money(summary.get("paidTotal")),
        "creditAdjustmentsAtIssue": credit_adjustments,
        "debitAdjustmentsAtIssue": debit_adjustments,
        "remainingBalanceAtIssue": money(summary.get("balance")),
    }


def capture_invoice_account_summary_at_issue(invoice: dict[str, Any]) -> dict[str, Any] | None:
    existing = invoice.get("accountSummaryAtIssue")
    if isinstance(existing, dict):
        return deepcopy(existing)
    if invoice.get("status") in {"DRAFT", "VOID"}:
        return None

    captured_at = now_iso()
    captured_moment = parse_record_moment(captured_at) or datetime.now(timezone.utc)
    as_of = parse_day(invoice.get("issueDate"), "issueDate")
    customer_id = clean_text(invoice.get("customerId"))
    prior_documents = [
        row
        for row in visible_invoices()
        if row.get("id") != invoice.get("id")
        and row.get("customerId") == customer_id
        and row.get("status") not in {"DRAFT", "VOID"}
    ]
    prior_document = max(
        prior_documents,
        key=lambda row: (
            clean_text(row.get("createdAt")),
            clean_text(row.get("issueDate")),
            clean_text(row.get("invoiceNumber")),
        ),
        default=None,
    )
    prior_account_summary = (
        prior_document.get("accountSummaryAtIssue")
        if prior_document and isinstance(prior_document.get("accountSummaryAtIssue"), dict)
        else {}
    )
    activity_start_at = clean_text(
        prior_account_summary.get("capturedAt")
        or prior_document.get("createdAt")
    ) if prior_document else ""
    activity_start_moment = parse_record_moment(activity_start_at)

    previous_open_invoices = [
        row
        for row in (
            previous_open_invoice_snapshot(prior_invoice, as_of)
            for prior_invoice in prior_documents
        )
        if row is not None
    ]
    previous_open_invoices.sort(
        key=lambda row: (
            row.get("dueDate") or "9999-12-31",
            row.get("invoiceNumber") or "",
        )
    )
    previous_balance = money(sum(row["remainingBalanceAtIssue"] for row in previous_open_invoices))

    payments_applied = money(
        sum(
            sum(money(allocation.get("amount")) for allocation in payment_allocations(payment))
            for payment in visible_payments()
            if payment.get("customerId") == customer_id
            and payment.get("status") == "POSTED"
            and moment_is_in_window(
                record_moment(payment, "postedAt", "createdAt"),
                activity_start_moment,
                captured_moment,
            )
        )
    ) if prior_document else 0.0
    account_credit_applied = money(
        sum(
            application.get("amount")
            for application in visible_credit_applications()
            if application.get("customerId") == customer_id
            and application.get("status") == "POSTED"
            and moment_is_in_window(
                record_moment(application, "appliedAt", "createdAt"),
                activity_start_moment,
                captured_moment,
            )
        )
    ) if prior_document else 0.0
    credits_posted = money(
        sum(
            adjustment.get("amount")
            for adjustment in visible_adjustments()
            if adjustment.get("customerId") == customer_id
            and adjustment.get("status") == "POSTED"
            and adjustment.get("type") == "CREDIT"
            and moment_is_in_window(
                record_moment(adjustment, "createdAt"),
                activity_start_moment,
                captured_moment,
            )
        )
    ) if prior_document else 0.0
    debits_posted = money(
        sum(
            adjustment.get("amount")
            for adjustment in visible_adjustments()
            if adjustment.get("customerId") == customer_id
            and adjustment.get("status") == "POSTED"
            and adjustment.get("type") == "DEBIT"
            and moment_is_in_window(
                record_moment(adjustment, "createdAt"),
                activity_start_moment,
                captured_moment,
            )
        )
    ) if prior_document else 0.0

    current_summary = invoice_summary(invoice)
    current_account_credit = money(
        sum(
            application.get("amount")
            for application in visible_credit_applications()
            if application.get("invoiceId") == invoice.get("id")
            and application.get("status") == "POSTED"
        )
    )
    snapshot = {
        "version": ACCOUNT_SUMMARY_SNAPSHOT_VERSION,
        "source": "ISSUE_TIME_LEDGER_SNAPSHOT",
        "capturedAt": captured_at,
        "asOfDate": as_of.isoformat(),
        "currency": "PHP",
        "previousInvoiceId": prior_document.get("id") if prior_document else "",
        "previousInvoiceNumber": prior_document.get("invoiceNumber") if prior_document else "",
        "activityStartAt": activity_start_at,
        "previousOpenInvoiceCount": len(previous_open_invoices),
        "previousBalance": previous_balance,
        "paymentsAppliedSincePreviousInvoice": payments_applied,
        "accountCreditAppliedSincePreviousInvoice": account_credit_applied,
        "creditsPostedSincePreviousInvoice": credits_posted,
        "debitsPostedSincePreviousInvoice": debits_posted,
        "currentInvoiceTotal": money(current_summary.get("total")),
        "currentInvoicePaidTotal": money(current_summary.get("paidTotal")),
        "currentInvoiceAccountCreditApplied": current_account_credit,
        "currentInvoiceBalance": money(current_summary.get("balance")),
        "totalAccountAmountDue": money(previous_balance + money(current_summary.get("balance"))),
        "previousOpenInvoices": previous_open_invoices,
    }
    invoice["accountSummaryAtIssue"] = snapshot
    return deepcopy(snapshot)


def customer_rebate_invoice(customer_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    candidates: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for invoice in visible_invoices():
        if invoice.get("customerId") != customer_id or invoice.get("invoiceType") == "INSTALLATION_FEE":
            continue
        summary = invoice_summary(invoice)
        if summary["status"] in {"DRAFT", "PAID", "VOID"} or money(summary["balance"]) <= 0:
            continue
        candidates.append((invoice, summary))
    if not candidates:
        raise HTTPException(status_code=409, detail="Customer has no outstanding service bill available for a rebate")

    monthly_candidates = [
        candidate
        for candidate in candidates
        if candidate[0].get("invoiceType") in MONTHLY_INVOICE_TYPES
    ]
    eligible = monthly_candidates or candidates
    return max(
        eligible,
        key=lambda candidate: (
            candidate[0].get("billingCycleStart") or "",
            candidate[0].get("issueDate") or "",
            candidate[0].get("createdAt") or "",
            candidate[0].get("invoiceNumber") or "",
        ),
    )


def parse_billing_datetime(value: Any, field_name: str) -> datetime:
    text = clean_text(value)
    if not text:
        raise HTTPException(status_code=400, detail=f"{field_name} is required")
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"{field_name} must be a valid date and time") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=BILLING_ZONE)
    return parsed.astimezone(BILLING_ZONE).replace(microsecond=0)


def normalize_outage_customer_ids(values: list[str] | None) -> list[str]:
    customer_ids = sorted({clean_text(value) for value in values or [] if clean_text(value)})
    if not customer_ids:
        raise HTTPException(status_code=400, detail="Select at least one customer")
    if len(customer_ids) > 500:
        raise HTTPException(status_code=400, detail="A rebate batch cannot exceed 500 customers")
    return customer_ids


def normalize_outage_window(start_value: Any, end_value: Any) -> tuple[datetime, datetime]:
    outage_start = parse_billing_datetime(start_value, "outageStart")
    outage_end = parse_billing_datetime(end_value, "outageEnd")
    if outage_end <= outage_start:
        raise HTTPException(status_code=400, detail="Outage end must be after outage start")
    if outage_end - outage_start > timedelta(days=366):
        raise HTTPException(status_code=400, detail="Outage duration cannot exceed 366 days")
    current_business_time = datetime.now(timezone.utc).astimezone(BILLING_ZONE)
    if outage_end > current_business_time + timedelta(minutes=1):
        raise HTTPException(status_code=400, detail="Outage end cannot be in the future")
    return outage_start, outage_end


def next_local_month_start(source: datetime) -> datetime:
    if source.month == 12:
        return datetime(source.year + 1, 1, 1, tzinfo=BILLING_ZONE)
    return datetime(source.year, source.month + 1, 1, tzinfo=BILLING_ZONE)


def prorated_monthly_outage_amount(monthly_rate: float, outage_start: datetime, outage_end: datetime) -> float:
    cursor = outage_start
    total = 0.0
    while cursor < outage_end:
        current_month_start = datetime(cursor.year, cursor.month, 1, tzinfo=BILLING_ZONE)
        following_month_start = next_local_month_start(cursor)
        segment_end = min(outage_end, following_month_start)
        month_seconds = (following_month_start - current_month_start).total_seconds()
        segment_seconds = (segment_end - cursor).total_seconds()
        total += float(monthly_rate) * segment_seconds / month_seconds
        cursor = segment_end
    return money(total)


def existing_outage_rebate(customer_id: str, outage_start: str, outage_end: str) -> dict[str, Any] | None:
    return next(
        (
            adjustment
            for adjustment in visible_adjustments()
            if adjustment.get("customerId") == customer_id
            and adjustment.get("status") == "POSTED"
            and adjustment.get("adjustmentSource") == "SERVICE_REBATE"
            and adjustment.get("outageStart") == outage_start
            and adjustment.get("outageEnd") == outage_end
        ),
        None,
    )


def outage_rebate_quote(payload: OutageRebatePreviewPayload | OutageRebateBatchPayload) -> dict[str, Any]:
    customer_ids = normalize_outage_customer_ids(payload.customerIds)
    outage_start, outage_end = normalize_outage_window(payload.outageStart, payload.outageEnd)
    outage_start_value = outage_start.isoformat()
    outage_end_value = outage_end.isoformat()
    duration_minutes = round((outage_end - outage_start).total_seconds() / 60, 2)
    rows: list[dict[str, Any]] = []

    for customer_id in customer_ids:
        customer = resolve_customer(customer_id)
        subscription_rows: list[dict[str, Any]] = []
        for subscription in visible_subscriptions():
            if (
                subscription.get("customerId") != customer_id
                or subscription.get("status") != "ACTIVE"
                or money(subscription.get("monthlyRate")) <= 0
            ):
                continue
            subscription_start_day = parse_day(subscription.get("startDate"), "subscription.startDate")
            subscription_start = datetime(
                subscription_start_day.year,
                subscription_start_day.month,
                subscription_start_day.day,
                tzinfo=BILLING_ZONE,
            )
            effective_start = max(outage_start, subscription_start)
            if effective_start >= outage_end:
                continue
            calculated_amount = prorated_monthly_outage_amount(
                money(subscription.get("monthlyRate")),
                effective_start,
                outage_end,
            )
            if calculated_amount <= 0:
                continue
            subscription_rows.append(
                {
                    "subscriptionId": subscription["id"],
                    "serviceAccountId": clean_text(subscription.get("serviceAccountId")),
                    "serviceAccountNumber": clean_text(subscription.get("serviceAccountNumber")),
                    "serviceId": clean_text(subscription.get("serviceId")),
                    "planName": clean_text(subscription.get("planName")) or "Monthly service",
                    "monthlyRate": money(subscription.get("monthlyRate")),
                    "effectiveOutageStart": effective_start.isoformat(),
                    "outageEnd": outage_end_value,
                    "durationMinutes": round((outage_end - effective_start).total_seconds() / 60, 2),
                    "calculatedAmount": calculated_amount,
                }
            )

        calculated_amount = money(sum(row["calculatedAmount"] for row in subscription_rows))
        monthly_recurring_charge = money(sum(row["monthlyRate"] for row in subscription_rows))
        invoice = None
        invoice_state = None
        ineligible_reason = ""
        try:
            invoice, invoice_state = customer_rebate_invoice(customer_id)
        except HTTPException as exc:
            if exc.status_code != 409:
                raise

        duplicate = existing_outage_rebate(customer_id, outage_start_value, outage_end_value)
        if duplicate:
            ineligible_reason = "Rebate already posted to this customer account for this outage window"
        elif not subscription_rows:
            ineligible_reason = "Customer has no active priced subscription during this outage window"
        elif calculated_amount <= 0:
            ineligible_reason = "The selected outage duration produces no billable rebate"

        invoice_balance = money(invoice_state.get("balance")) if invoice_state else 0.0
        rebate_amount = calculated_amount if not ineligible_reason else 0.0
        apply_now_amount = money(min(rebate_amount, invoice_balance))
        carry_forward_amount = money(max(0, rebate_amount - apply_now_amount))
        application_mode = (
            "CURRENT_BILL_AND_ACCOUNT_CREDIT"
            if apply_now_amount > 0 and carry_forward_amount > 0
            else "CURRENT_BILL"
            if apply_now_amount > 0
            else "NEXT_INVOICE"
        )
        rows.append(
            {
                "customerId": customer_id,
                "customer": customer,
                "eligible": not ineligible_reason,
                "ineligibleReason": ineligible_reason,
                "subscriptionCount": len(subscription_rows),
                "subscriptions": subscription_rows,
                "monthlyRecurringCharge": monthly_recurring_charge,
                "calculatedAmount": calculated_amount,
                "rebateAmount": rebate_amount,
                "applyNowAmount": apply_now_amount,
                "carryForwardAmount": carry_forward_amount,
                "applicationMode": application_mode,
                "cappedToInvoiceBalance": False,
                "invoiceId": invoice.get("id") if invoice else "",
                "invoiceNumber": invoice.get("invoiceNumber") if invoice else "",
                "invoiceBalance": invoice_balance,
            }
        )

    rows.sort(key=lambda row: (customer_name(row["customer"]).lower(), row["customerId"]))
    fingerprint_rows = [
        {
            "customerId": row["customerId"],
            "eligible": row["eligible"],
            "ineligibleReason": row["ineligibleReason"],
            "invoiceId": row["invoiceId"],
            "invoiceBalance": row["invoiceBalance"],
            "subscriptions": [
                {
                    "subscriptionId": subscription["subscriptionId"],
                    "monthlyRate": subscription["monthlyRate"],
                    "effectiveOutageStart": subscription["effectiveOutageStart"],
                    "calculatedAmount": subscription["calculatedAmount"],
                }
                for subscription in row["subscriptions"]
            ],
            "calculatedAmount": row["calculatedAmount"],
            "rebateAmount": row["rebateAmount"],
            "applyNowAmount": row["applyNowAmount"],
            "carryForwardAmount": row["carryForwardAmount"],
            "applicationMode": row["applicationMode"],
        }
        for row in rows
    ]
    quote_fingerprint = posting_fingerprint(
        "outage_rebate_quote",
        {
            "version": OUTAGE_REBATE_QUOTE_VERSION,
            "customerIds": customer_ids,
            "outageStart": outage_start_value,
            "outageEnd": outage_end_value,
            "rows": fingerprint_rows,
        },
    )
    eligible_rows = [row for row in rows if row["eligible"]]
    return {
        "version": OUTAGE_REBATE_QUOTE_VERSION,
        "timezone": BILLING_TIMEZONE,
        "calculationMethod": "ACTUAL_CALENDAR_MONTH_HOURLY_PRORATION",
        "outageStart": outage_start_value,
        "outageEnd": outage_end_value,
        "durationMinutes": duration_minutes,
        "durationHours": round(duration_minutes / 60, 2),
        "customerCount": len(rows),
        "eligibleCount": len(eligible_rows),
        "ineligibleCount": len(rows) - len(eligible_rows),
        "canPost": bool(rows) and len(eligible_rows) == len(rows),
        "totalCalculatedAmount": money(sum(row["calculatedAmount"] for row in rows)),
        "totalRebateAmount": money(sum(row["rebateAmount"] for row in eligible_rows)),
        "quoteFingerprint": quote_fingerprint,
        "rows": rows,
    }


def outage_rebate_batch_response(
    batch_adjustments: list[dict[str, Any]],
    *,
    idempotent_replay: bool = False,
) -> dict[str, Any]:
    ordered = sorted(
        [adjustment_summary(adjustment) for adjustment in batch_adjustments],
        key=lambda adjustment: (
            customer_name(adjustment.get("customer") or {}).lower(),
            adjustment.get("customerId") or "",
        ),
    )
    first = ordered[0]
    return {
        "batchId": first.get("outageBatchId"),
        "outageStart": first.get("outageStart"),
        "outageEnd": first.get("outageEnd"),
        "timezone": first.get("outageTimezone") or BILLING_TIMEZONE,
        "durationMinutes": first.get("outageDurationMinutes"),
        "durationHours": first.get("outageDurationHours"),
        "customerCount": len(ordered),
        "totalRebateAmount": money(sum(adjustment.get("amount") for adjustment in ordered)),
        "totalAppliedAmount": money(sum(adjustment.get("creditAppliedAmount") for adjustment in ordered)),
        "totalAvailableCredit": money(sum(adjustment.get("creditAvailableAmount") for adjustment in ordered)),
        "previewFingerprint": first.get("outageQuoteFingerprint"),
        "idempotentReplay": idempotent_replay,
        "adjustments": ordered,
    }


def post_credit_application(
    invoice: dict[str, Any],
    amount: float,
    actor_username: str,
    *,
    source_payment: dict[str, Any] | None = None,
    source_adjustment: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if (source_payment is None) == (source_adjustment is None):
        raise RuntimeError("A credit application requires exactly one source")
    timestamp = now_iso()
    customer_id = clean_text(invoice.get("customerId"))
    source_type = "PAYMENT_ADVANCE" if source_payment is not None else "ADJUSTMENT_CREDIT"
    source_label = (
        "Advance payment"
        if source_payment is not None
        else (
            "Service rebate"
            if source_adjustment.get("adjustmentSource") == "SERVICE_REBATE"
            else "Account credit"
        )
    )
    application = {
        "id": str(uuid4()),
        "customerId": customer_id,
        "customer": (
            invoice.get("customer")
            or (source_payment or {}).get("customer")
            or (source_adjustment or {}).get("customer")
            or {}
        ),
        "sourceType": source_type,
        "sourcePaymentId": (source_payment or {}).get("id") or "",
        "sourceReceiptNumber": (source_payment or {}).get("receiptNumber") or "",
        "sourceAdjustmentId": (source_adjustment or {}).get("id") or "",
        "sourceLabel": source_label,
        "sourceReason": (source_adjustment or {}).get("reason") or "",
        "invoiceId": invoice["id"],
        "invoiceNumber": invoice.get("invoiceNumber") or "",
        "amount": money(amount),
        "status": "POSTED",
        "appliedAt": timestamp,
        "appliedByUsername": actor_username,
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": None,
    }
    credit_applications.append(application)
    invoice["updatedAt"] = timestamp
    audit_action = (
        "billing_advance_credit_applied"
        if source_payment is not None
        else "billing_adjustment_credit_applied"
    )
    add_audit(
        audit_action,
        "BillingCreditApplication",
        application["id"],
        {
            "customerId": customer_id,
            "sourceType": source_type,
            "sourcePaymentId": application["sourcePaymentId"],
            "sourceReceiptNumber": application["sourceReceiptNumber"],
            "sourceAdjustmentId": application["sourceAdjustmentId"],
            "invoiceId": invoice["id"],
            "invoiceNumber": invoice.get("invoiceNumber") or "",
            "amount": application["amount"],
        },
        actor_username,
    )
    return application


def apply_adjustment_credit_to_invoice(
    adjustment: dict[str, Any],
    invoice: dict[str, Any],
    actor_username: str = "system",
) -> list[dict[str, Any]]:
    if invoice.get("status") in {"DRAFT", "VOID"}:
        return []
    if adjustment.get("customerId") != invoice.get("customerId"):
        raise RuntimeError("A customer credit cannot be applied to another customer's invoice")
    available = adjustment_credit_remaining(adjustment)
    invoice_balance = money(invoice_summary(invoice).get("balance"))
    if available <= 0 or invoice_balance <= 0:
        return []
    return [
        post_credit_application(
            invoice,
            min(invoice_balance, available),
            actor_username,
            source_adjustment=adjustment,
        )
    ]


def apply_available_customer_credit(invoice: dict[str, Any], actor_username: str = "system") -> list[dict[str, Any]]:
    """Apply posted advance and adjustment credits FIFO to a newly issued invoice."""
    if invoice.get("status") in {"DRAFT", "VOID"}:
        return []
    customer_id = clean_text(invoice.get("customerId"))
    if not customer_id or customer_credit_balance(customer_id) <= 0:
        return []
    applied_rows: list[dict[str, Any]] = []
    sources = [
        {
            "sourceType": "PAYMENT_ADVANCE",
            "source": payment,
            "sortAt": payment.get("paymentDate") or payment.get("createdAt") or "",
            "sortId": payment.get("receiptNumber") or payment.get("id") or "",
        }
        for payment in visible_payments()
        if payment.get("customerId") == customer_id
        and payment.get("status") == "POSTED"
        and payment_advance_remaining(payment) > 0
    ]
    sources.extend(
        {
            "sourceType": "ADJUSTMENT_CREDIT",
            "source": adjustment,
            "sortAt": adjustment.get("createdAt") or "",
            "sortId": adjustment.get("id") or "",
        }
        for adjustment in visible_adjustments()
        if adjustment.get("customerId") == customer_id
        and adjustment_credit_remaining(adjustment) > 0
    )
    sources.sort(
        key=lambda source: (
            source["sortAt"],
            source["sourceType"],
            source["sortId"],
        )
    )
    for source_row in sources:
        invoice_balance = money(invoice_summary(invoice).get("balance"))
        if invoice_balance <= 0:
            break
        source = source_row["source"]
        available = (
            payment_advance_remaining(source)
            if source_row["sourceType"] == "PAYMENT_ADVANCE"
            else adjustment_credit_remaining(source)
        )
        if available <= 0:
            continue
        applied_amount = money(min(invoice_balance, available))
        application = post_credit_application(
            invoice,
            applied_amount,
            actor_username,
            source_payment=source if source_row["sourceType"] == "PAYMENT_ADVANCE" else None,
            source_adjustment=source if source_row["sourceType"] == "ADJUSTMENT_CREDIT" else None,
        )
        applied_rows.append(application)
    return applied_rows


def normalize_payment_allocations(
    payload: PaymentPayload,
    amount: float,
    advance_amount: float = 0,
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any] | None]:
    raw_allocations = payload.allocations or []
    if raw_allocations:
        if payload.invoiceId:
            requested_invoice_ids = {clean_text(allocation.invoiceId) for allocation in raw_allocations}
            if requested_invoice_ids != {clean_text(payload.invoiceId)}:
                raise HTTPException(status_code=400, detail="invoiceId must match the supplied allocation invoice")
    elif payload.invoiceId:
        raw_allocations = [PaymentAllocationPayload(invoiceId=payload.invoiceId, amount=money(amount - advance_amount))]
    elif advance_amount <= 0:
        raise HTTPException(status_code=400, detail="invoiceId or allocations are required")

    customer_id = clean_text(payload.customerId)
    customer: dict[str, Any] | None = None
    primary_invoice: dict[str, Any] | None = None
    allocations: list[dict[str, Any]] = []
    seen_invoice_ids: set[str] = set()

    for allocation_payload in raw_allocations:
        invoice_id = clean_text(allocation_payload.invoiceId)
        if not invoice_id:
            raise HTTPException(status_code=400, detail="Allocation invoiceId is required")
        if invoice_id in seen_invoice_ids:
            raise HTTPException(status_code=400, detail="Duplicate invoice allocations are not allowed")
        seen_invoice_ids.add(invoice_id)
        invoice = find_invoice(invoice_id)
        allocation_amount = money(allocation_payload.amount)
        if allocation_amount <= 0:
            raise HTTPException(status_code=400, detail="Allocation amount must be greater than zero")
        if customer_id and invoice["customerId"] != customer_id:
            raise HTTPException(status_code=400, detail="All allocated invoices must belong to the selected customer")
        if not customer_id:
            customer_id = invoice["customerId"]
            customer = invoice["customer"]
        elif customer is None:
            customer = invoice["customer"]
        if invoice["customerId"] != customer_id:
            raise HTTPException(status_code=400, detail="All allocated invoices must belong to the same customer")
        validate_invoice_payment(invoice, allocation_amount)
        allocation_promotion_ids = normalized_promotion_ids(
            allocation_payload.promotionIds,
            "allocation promotion IDs",
        )
        legacy_promotion_id = clean_text(allocation_payload.promotionId)
        if legacy_promotion_id and legacy_promotion_id not in allocation_promotion_ids:
            allocation_promotion_ids.append(legacy_promotion_id)
        primary_invoice = primary_invoice or invoice
        allocations.append(
            {
                "id": str(uuid4()),
                "invoiceId": invoice["id"],
                "invoiceNumber": invoice["invoiceNumber"],
                "customerId": invoice["customerId"],
                "amount": allocation_amount,
                "promotionId": allocation_promotion_ids[0] if len(allocation_promotion_ids) == 1 else "",
                "promotionIds": allocation_promotion_ids,
                "promotionQuoteDate": clean_text(allocation_payload.promotionQuoteDate)[:20],
                "promotionQuoteFingerprint": clean_text(allocation_payload.promotionQuoteFingerprint)[:128],
                "balanceBefore": money(invoice_summary(invoice)["balance"]),
                "serviceAccountId": invoice.get("serviceAccountId", ""),
                "serviceAccountNumber": invoice.get("serviceAccountNumber", ""),
                "serviceId": invoice.get("serviceId", ""),
                "catalogName": invoice.get("catalogName", ""),
                "dueDate": invoice.get("dueDate", ""),
            }
        )

    allocation_total = money(sum(allocation["amount"] for allocation in allocations))
    if money(allocation_total + advance_amount) != amount:
        raise HTTPException(
            status_code=400,
            detail="Payment amount must equal invoice allocations plus advance credit",
        )
    if customer is None:
        if not customer_id:
            raise HTTPException(status_code=400, detail="customerId is required for an advance payment")
        customer = resolve_customer(customer_id)
    return customer, allocations, primary_invoice if len(allocations) == 1 else None


def payment_promotion_adjustment(invoice_id: str, promotion_id: str = "") -> dict[str, Any] | None:
    for adjustment in invoice_adjustments(invoice_id):
        if (
            adjustment.get("adjustmentSource") == "PAYMENT_PROMOTION"
            and (not promotion_id or clean_text(adjustment.get("promotionId")) == promotion_id)
        ):
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


def payment_promotion_validity_day(invoice: dict[str, Any], promotion: dict[str, Any], payment_day: date) -> date:
    if promotion_payment_rule(promotion) == "EARLY_BIRD":
        return payment_day
    for field_name in ("billingCycleStart", "issueDate", "billingCycleEnd", "dueDate"):
        field_value = clean_text(invoice.get(field_name))
        if field_value:
            return parse_day(field_value, field_name)
    return payment_day


def invoice_qualified_promotion_terms(invoice: dict[str, Any]) -> list[dict[str, Any]]:
    snapshots = invoice.get("qualifiedPromotions")
    snapshot_by_id = {
        clean_text(snapshot.get("id")): dict(snapshot)
        for snapshot in snapshots or []
        if isinstance(snapshot, dict) and clean_text(snapshot.get("id"))
    }
    promotion_ids = normalized_promotion_ids(
        invoice.get("qualifiedPromotionIds"),
        "invoice qualified promotion IDs",
    )
    if not promotion_ids:
        promotion_ids = list(snapshot_by_id)
    if not promotion_ids:
        subscription_id = clean_text(invoice.get("subscriptionId"))
        if subscription_id:
            try:
                subscription = find_subscription(subscription_id)
            except HTTPException:
                subscription = None
            if subscription is not None:
                subscription_snapshots = subscription.get("qualifiedPromotions") or []
                snapshot_by_id = {
                    clean_text(snapshot.get("id")): dict(snapshot)
                    for snapshot in subscription_snapshots
                    if isinstance(snapshot, dict) and clean_text(snapshot.get("id"))
                }
                promotion_ids = normalized_promotion_ids(
                    subscription.get("qualifiedPromotionIds"),
                    "subscription qualified promotion IDs",
                )
                if not promotion_ids:
                    promotion_ids = list(snapshot_by_id)
    if not promotion_ids:
        legacy_promotion_id = clean_text(invoice.get("earlyBirdPromotionId"))
        if clean_bool(invoice.get("earlyBirdEligible")) and legacy_promotion_id:
            promotion_ids = [legacy_promotion_id]

    promotion_terms: list[dict[str, Any]] = []
    for promotion_id in promotion_ids:
        try:
            live_promotion = find_promotion(promotion_id)
        except HTTPException:
            continue
        snapshot = snapshot_by_id.get(promotion_id, {})
        terms = {
            **live_promotion,
            **snapshot,
            "id": promotion_id,
            "status": live_promotion.get("status"),
            "startDate": live_promotion.get("startDate"),
            "endDate": live_promotion.get("endDate"),
            "requiresApproval": live_promotion.get("requiresApproval"),
            "billingMode": live_promotion.get("billingMode"),
            "appliesTo": live_promotion.get("appliesTo"),
        }
        promotion_terms.append(terms)
    return sorted(promotion_terms, key=promotion_order_key)


def payment_promotion_option(invoice: dict[str, Any], promotion: dict[str, Any], payment_day: date) -> dict[str, Any] | None:
    summary = invoice_summary(invoice)
    if summary["status"] in ["VOID", "DRAFT", "PAID"] or money(summary.get("balance")) <= 0:
        return None
    if payment_promotion_adjustment(invoice["id"], clean_text(promotion.get("id"))):
        return None
    if not promotion_matches_invoice_scope(promotion, invoice):
        return None
    payment_rule = promotion_payment_rule(promotion)
    if not promotion_is_active(promotion, payment_promotion_validity_day(invoice, promotion, payment_day)):
        return None
    if clean_bool(promotion.get("requiresApproval")):
        return None
    if promotion.get("billingMode") and promotion.get("billingMode") != invoice.get("billingMode"):
        return None
    auto_apply = True
    if payment_rule == "EARLY_BIRD":
        if not summary.get("earlyBirdEligible"):
            return None
        cutoff_date = summary.get("earlyBirdCutoffDate")
        if not cutoff_date:
            return None
        cutoff_day = parse_day(cutoff_date, "earlyBirdCutoffDate")
        if payment_day >= cutoff_day:
            return None
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
        for promotion in invoice_qualified_promotion_terms(invoice)
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


def recommended_payment_promotion_bundle(
    invoice: dict[str, Any],
    options: list[dict[str, Any]],
) -> dict[str, Any] | None:
    automatic_options = [option for option in options if option.get("autoApply")]
    if not automatic_options:
        return None
    highest_priority = automatic_options[0]
    selected_options = (
        [option for option in automatic_options if clean_bool(option.get("stackable"))]
        if clean_bool(highest_priority.get("stackable"))
        else [highest_priority]
    )
    quote = promotion_bundle_quote(selected_options, money(invoice_summary(invoice)["balance"]))
    if quote["discountedPayable"] <= 0 and len(selected_options) > 1:
        quote = promotion_bundle_quote([highest_priority], money(invoice_summary(invoice)["balance"]))
    if quote["discountedPayable"] <= 0 or not quote["promotions"]:
        return None
    return {
        **quote,
        "invoiceId": invoice["id"],
        "invoiceNumber": invoice["invoiceNumber"],
        "invoiceBalance": money(invoice_summary(invoice)["balance"]),
        "autoApply": True,
    }


def payment_promotion_quote(invoice: dict[str, Any], payment_day: date) -> dict[str, Any]:
    """Return the authoritative automatic-promotion quote used by payment channels."""
    summary = invoice_summary(invoice)
    invoice_balance = money(summary.get("balance"))
    options = eligible_payment_promotions(invoice, payment_day)
    bundle = recommended_payment_promotion_bundle(invoice, options) or {
        "promotionIds": [],
        "promotions": [],
        "discountAmount": 0.0,
        "discountedPayable": invoice_balance,
    }
    promotion_rows = [
        {
            "id": clean_text(promotion.get("id")),
            "name": clean_text(promotion.get("name")),
            "promoCode": clean_text(promotion.get("promoCode")),
            "paymentRule": clean_text(promotion.get("paymentRule")),
            "discountAmount": money(promotion.get("discountAmountForInvoice")),
        }
        for promotion in bundle.get("promotions") or []
    ]
    quote_payload = {
        "version": PAYMENT_PROMOTION_QUOTE_VERSION,
        "paymentDate": payment_day.isoformat(),
        "invoiceId": invoice["id"],
        "invoiceBalance": invoice_balance,
        "promotionIds": list(bundle.get("promotionIds") or []),
        "promotionDiscountAmount": money(bundle.get("discountAmount")),
        "discountedPayable": money(bundle.get("discountedPayable", invoice_balance)),
    }
    return {
        "version": PAYMENT_PROMOTION_QUOTE_VERSION,
        "paymentDate": payment_day.isoformat(),
        "quoteFingerprint": posting_fingerprint("payment_promotion_quote", quote_payload),
        "invoiceBalance": invoice_balance,
        "promotionIds": quote_payload["promotionIds"],
        "promotions": promotion_rows,
        "promotionDiscountAmount": quote_payload["promotionDiscountAmount"],
        "discountedPayable": quote_payload["discountedPayable"],
        "hasAutomaticPromotion": bool(quote_payload["promotionIds"]),
    }


def payment_promotions_for_payment(
    invoice: dict[str, Any],
    promotion_ids: list[str],
    amount: float,
    payment_day: date,
) -> list[dict[str, Any]]:
    requested_ids = normalized_promotion_ids(promotion_ids, "payment promotion IDs")
    options_by_id = {
        option["id"]: option
        for option in eligible_payment_promotions(invoice, payment_day)
    }
    selected_options: list[dict[str, Any]] = []
    for promotion_id in requested_ids:
        option = options_by_id.get(promotion_id)
        if option is None:
            raise HTTPException(status_code=400, detail="Promotion is not eligible for this invoice payment")
        selected_options.append(option)
    quote = promotion_bundle_quote(selected_options, money(invoice_summary(invoice)["balance"]))
    discounted_payable = money(quote["discountedPayable"])
    if discounted_payable <= 0:
        raise HTTPException(status_code=400, detail="Combined promotions must leave a payable invoice balance")
    if amount > discounted_payable:
        raise HTTPException(status_code=400, detail=f"Payment amount cannot exceed promo payable balance of {discounted_payable:.2f}")
    if amount != discounted_payable:
        raise HTTPException(status_code=400, detail=f"Payment amount must equal promo payable balance of {discounted_payable:.2f} to apply this promotion")
    return quote["promotions"]


def automatic_payment_promotions_for_payment(
    invoice: dict[str, Any],
    amount: float,
    payment_day: date,
) -> list[dict[str, Any]]:
    options = eligible_payment_promotions(invoice, payment_day)
    bundle = recommended_payment_promotion_bundle(invoice, options)
    if bundle is not None and amount == money(bundle.get("discountedPayable")):
        return bundle["promotions"]
    return []


def automatic_payment_promotion_for_payment(invoice: dict[str, Any], amount: float, payment_day: date) -> dict[str, Any] | None:
    promotions_for_payment = automatic_payment_promotions_for_payment(invoice, amount, payment_day)
    return promotions_for_payment[0] if len(promotions_for_payment) == 1 else None


def payment_promotion_for_payment(invoice: dict[str, Any], promotion_id: str, amount: float, payment_day: date) -> dict[str, Any]:
    promotions_for_payment = payment_promotions_for_payment(invoice, [promotion_id], amount, payment_day)
    return promotions_for_payment[0]


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
    balance = money(sum(invoice["balance"] for invoice in customer_invoices))
    available_credit = customer_credit_balance(customer_id)
    overdue_total = money(sum(invoice["balance"] for invoice in customer_invoices if invoice["status"] == "OVERDUE"))
    unpaid_months = unpaid_month_summary(customer_invoices)
    missing_cycles = missing_billing_cycle_summary_for_subscriptions(customer_subscriptions, customer_invoices)
    return {
        "customer": customer,
        "invoicedTotal": invoiced_total,
        "paidTotal": paid_total,
        "balance": balance,
        "credit": available_credit,
        "overdueTotal": overdue_total,
        "openInvoices": sum(1 for invoice in customer_invoices if invoice["status"] not in ["PAID", "VOID"]),
        **unpaid_months,
        **missing_cycles,
    }


def latest_posted_customer_payments(as_of: date | None = None) -> dict[str, dict[str, Any]]:
    latest_by_customer: dict[str, dict[str, Any]] = {}
    for payment in visible_payments():
        customer_id = clean_text(payment.get("customerId"))
        if not customer_id or payment.get("status") != "POSTED":
            continue
        if as_of is not None and not posting_active_as_of(
            payment,
            as_of,
            ("paymentDate", "postedAt", "createdAt"),
        ):
            continue
        current = latest_by_customer.get(customer_id)
        recency = (
            clean_text(payment.get("paymentDate")),
            clean_text(payment.get("postedAt") or payment.get("createdAt")),
            clean_text(payment.get("id")),
        )
        current_recency = (
            clean_text(current.get("paymentDate")),
            clean_text(current.get("postedAt") or current.get("createdAt")),
            clean_text(current.get("id")),
        ) if current else ("", "", "")
        if current is None or recency > current_recency:
            latest_by_customer[customer_id] = payment
    return latest_by_customer


def reporting_record_day(value: Any) -> date | None:
    text = clean_text(value)
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def posting_active_as_of(
    record: dict[str, Any],
    as_of: date,
    posting_fields: tuple[str, ...],
) -> bool:
    posting_days = [
        parsed
        for field_name in posting_fields
        if (parsed := reporting_record_day(record.get(field_name))) is not None
    ]
    if posting_days and max(posting_days) > as_of:
        return False
    status = normalize_upper(record.get("status"))
    if status == "POSTED":
        return True
    if status != "VOID":
        return False
    voided_day = reporting_record_day(record.get("voidedAt"))
    return voided_day is not None and voided_day > as_of


def invoice_active_as_of(invoice: dict[str, Any], as_of: date) -> bool:
    status = normalize_upper(invoice.get("status"))
    if status == "DRAFT":
        return False
    posting_days = [
        parsed
        for value in (invoice.get("createdAt"), invoice.get("issueDate"))
        if (parsed := reporting_record_day(value)) is not None
    ]
    if posting_days and max(posting_days) > as_of:
        return False
    if status != "VOID":
        return True
    voided_day = reporting_record_day(invoice.get("voidedAt"))
    return voided_day is not None and voided_day > as_of


def parse_billing_month(value: str | None, default_day: date) -> date:
    month_value = clean_text(value) or default_day.strftime("%Y-%m")
    try:
        parsed = date.fromisoformat(f"{month_value}-01")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="billingMonth must be YYYY-MM") from exc
    if parsed.strftime("%Y-%m") != month_value:
        raise HTTPException(status_code=400, detail="billingMonth must be YYYY-MM")
    return parsed


def collection_postings_as_of(report_day: date) -> dict[str, Any]:
    adjustments_by_invoice: dict[str, list[dict[str, Any]]] = {}
    source_adjustments: dict[str, dict[str, Any]] = {}
    for adjustment in visible_adjustments():
        adjustment_id = clean_text(adjustment.get("id"))
        if adjustment_id:
            source_adjustments[adjustment_id] = adjustment
        invoice_id = clean_text(adjustment.get("invoiceId"))
        if not invoice_id or not posting_active_as_of(adjustment, report_day, ("createdAt",)):
            continue
        adjustments_by_invoice.setdefault(invoice_id, []).append(adjustment)

    cash_by_invoice: dict[str, float] = {}
    for payment in visible_payments():
        if not posting_active_as_of(payment, report_day, ("paymentDate", "postedAt", "createdAt")):
            continue
        for allocation in payment_allocations(payment):
            invoice_id = clean_text(allocation.get("invoiceId"))
            if not invoice_id:
                continue
            cash_by_invoice[invoice_id] = money(
                cash_by_invoice.get(invoice_id, 0) + money(allocation.get("amount"))
            )

    account_credit_by_invoice: dict[str, float] = {}
    rebate_credit_by_invoice: dict[str, float] = {}
    for application in visible_credit_applications():
        if not posting_active_as_of(application, report_day, ("appliedAt", "createdAt")):
            continue
        invoice_id = clean_text(application.get("invoiceId"))
        if not invoice_id:
            continue
        application_amount = money(application.get("amount"))
        account_credit_by_invoice[invoice_id] = money(
            account_credit_by_invoice.get(invoice_id, 0) + application_amount
        )
        source_adjustment = source_adjustments.get(clean_text(application.get("sourceAdjustmentId")))
        if source_adjustment and source_adjustment.get("adjustmentSource") == "SERVICE_REBATE":
            rebate_credit_by_invoice[invoice_id] = money(
                rebate_credit_by_invoice.get(invoice_id, 0) + application_amount
            )

    return {
        "adjustmentsByInvoice": adjustments_by_invoice,
        "cashByInvoice": cash_by_invoice,
        "accountCreditByInvoice": account_credit_by_invoice,
        "rebateCreditByInvoice": rebate_credit_by_invoice,
    }


def receivables_aging_summary(
    report_day: date,
    adjustments_by_invoice: dict[str, list[dict[str, Any]]],
    cash_by_invoice: dict[str, float],
    account_credit_by_invoice: dict[str, float],
) -> dict[str, Any]:
    bucket_rows = [
        {"key": "CURRENT", "label": "Current", "amount": 0.0, "invoiceCount": 0},
        {"key": "DAYS_1_30", "label": "1-30 Days", "amount": 0.0, "invoiceCount": 0},
        {"key": "DAYS_31_60", "label": "31-60 Days", "amount": 0.0, "invoiceCount": 0},
        {"key": "DAYS_61_90", "label": "61-90 Days", "amount": 0.0, "invoiceCount": 0},
        {"key": "DAYS_90_PLUS", "label": "90+ Days", "amount": 0.0, "invoiceCount": 0},
    ]
    buckets_by_key = {bucket["key"]: bucket for bucket in bucket_rows}
    customer_ids_by_bucket = {bucket["key"]: set() for bucket in bucket_rows}
    open_customer_ids: set[str] = set()
    overdue_customer_ids: set[str] = set()
    open_amount = 0.0
    overdue_amount = 0.0
    open_invoice_count = 0
    overdue_invoice_count = 0
    oldest_days_overdue = 0

    for invoice in visible_invoices():
        if not invoice_active_as_of(invoice, report_day):
            continue
        invoice_id = clean_text(invoice.get("id"))
        subtotal = money(
            sum(item.get("amount", line_amount(item)) for item in invoice.get("lineItems", []))
        )
        invoice_adjustments = adjustments_by_invoice.get(invoice_id, [])
        debit_total = money(
            sum(row.get("amount") for row in invoice_adjustments if row.get("type") == "DEBIT")
        )
        credit_total = money(
            sum(row.get("amount") for row in invoice_adjustments if row.get("type") == "CREDIT")
        )
        billed_amount = money(max(0, subtotal + debit_total - credit_total))
        outstanding = money(
            max(
                0,
                billed_amount
                - cash_by_invoice.get(invoice_id, 0.0)
                - account_credit_by_invoice.get(invoice_id, 0.0),
            )
        )
        if outstanding <= 0:
            continue

        due_day = reporting_record_day(invoice.get("dueDate"))
        days_overdue = max(0, (report_day - due_day).days) if due_day and due_day < report_day else 0
        if days_overdue <= 0:
            bucket_key = "CURRENT"
        elif days_overdue <= 30:
            bucket_key = "DAYS_1_30"
        elif days_overdue <= 60:
            bucket_key = "DAYS_31_60"
        elif days_overdue <= 90:
            bucket_key = "DAYS_61_90"
        else:
            bucket_key = "DAYS_90_PLUS"

        customer_id = clean_text(invoice.get("customerId"))
        bucket = buckets_by_key[bucket_key]
        bucket["amount"] = money(bucket["amount"] + outstanding)
        bucket["invoiceCount"] += 1
        if customer_id:
            customer_ids_by_bucket[bucket_key].add(customer_id)
            open_customer_ids.add(customer_id)

        open_amount = money(open_amount + outstanding)
        open_invoice_count += 1
        if days_overdue > 0:
            overdue_amount = money(overdue_amount + outstanding)
            overdue_invoice_count += 1
            oldest_days_overdue = max(oldest_days_overdue, days_overdue)
            if customer_id:
                overdue_customer_ids.add(customer_id)

    aging_buckets = [
        {
            **bucket,
            "customerCount": len(customer_ids_by_bucket[bucket["key"]]),
        }
        for bucket in bucket_rows
    ]
    return {
        "openAmount": open_amount,
        "openInvoiceCount": open_invoice_count,
        "openCustomerCount": len(open_customer_ids),
        "overdueAmount": overdue_amount,
        "overdueInvoiceCount": overdue_invoice_count,
        "overdueCustomerCount": len(overdue_customer_ids),
        "oldestDaysOverdue": oldest_days_overdue,
        "agingBuckets": aging_buckets,
    }


def monthly_collection_performance(
    billing_month: str = "",
    as_of: date | None = None,
    status: str = "ALL",
    search: str = "",
    page: int = 1,
    page_size: int = 20,
) -> dict[str, Any]:
    """Report monthly-service settlement by unique billed customer and cash separately."""
    report_day = as_of or billing_business_date()
    business_today = billing_business_date()
    if report_day > business_today:
        raise HTTPException(status_code=400, detail="asOf cannot be in the future")
    period_start = parse_billing_month(billing_month, report_day)
    period_key = period_start.strftime("%Y-%m")
    normalized_status = normalize_upper(status or "ALL")
    if normalized_status not in COLLECTION_PERFORMANCE_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=(
                "status must be ALL, ACTION_REQUIRED, FULLY_PAID, "
                "PARTIALLY_PAID, or UNPAID"
            ),
        )

    postings = collection_postings_as_of(report_day)
    adjustments_by_invoice = postings["adjustmentsByInvoice"]
    cash_by_invoice = postings["cashByInvoice"]
    account_credit_by_invoice = postings["accountCreditByInvoice"]
    rebate_credit_by_invoice = postings["rebateCreditByInvoice"]

    available_months: set[str] = {period_key}
    cohort_invoices: list[dict[str, Any]] = []
    for invoice in visible_invoices():
        if normalize_upper(invoice.get("invoiceType")) not in MONTHLY_INVOICE_TYPES:
            continue
        month_value = clean_text(invoice.get("billingCycleStart") or invoice.get("issueDate"))[:7]
        try:
            parsed_month = date.fromisoformat(f"{month_value}-01").strftime("%Y-%m")
        except ValueError:
            continue
        available_months.add(parsed_month)
        if parsed_month != period_key or not invoice_active_as_of(invoice, report_day):
            continue
        cohort_invoices.append(invoice)

    grouped: dict[str, dict[str, Any]] = {}
    for invoice in cohort_invoices:
        customer_id = clean_text(invoice.get("customerId"))
        if not customer_id:
            continue
        group = grouped.get(customer_id)
        if group is None:
            try:
                customer = resolve_customer(customer_id)
            except (HTTPException, KeyError, TypeError):
                customer = dict(invoice.get("customer") or {})
            group = {
                "customerId": customer_id,
                "customer": customer,
                "invoiceCount": 0,
                "invoiceNumbers": [],
                "serviceAccountNumbers": [],
                "grossCharges": 0.0,
                "invoiceCredits": 0.0,
                "billedAmount": 0.0,
                "cashCollected": 0.0,
                "accountCreditsApplied": 0.0,
                "rebatesApplied": 0.0,
                "creditsApplied": 0.0,
                "outstandingAmount": 0.0,
                "overdueAmount": 0.0,
                "oldestDueDate": "",
                "oldestOverdueDate": "",
                "daysOverdue": 0,
            }
            grouped[customer_id] = group

        invoice_id = clean_text(invoice.get("id"))
        subtotal = money(
            sum(item.get("amount", line_amount(item)) for item in invoice.get("lineItems", []))
        )
        invoice_adjustment_rows = adjustments_by_invoice.get(invoice_id, [])
        debit_total = money(
            sum(row.get("amount") for row in invoice_adjustment_rows if row.get("type") == "DEBIT")
        )
        credit_total = money(
            sum(row.get("amount") for row in invoice_adjustment_rows if row.get("type") == "CREDIT")
        )
        direct_rebate_total = money(
            sum(
                row.get("amount")
                for row in invoice_adjustment_rows
                if row.get("type") == "CREDIT" and row.get("adjustmentSource") == "SERVICE_REBATE"
            )
        )
        gross_charges = money(subtotal + debit_total)
        billed_amount = money(max(0, gross_charges - credit_total))
        cash_collected = cash_by_invoice.get(invoice_id, 0.0)
        account_credits = account_credit_by_invoice.get(invoice_id, 0.0)
        rebates_applied = money(direct_rebate_total + rebate_credit_by_invoice.get(invoice_id, 0.0))
        outstanding = money(max(0, billed_amount - cash_collected - account_credits))
        due_day = reporting_record_day(invoice.get("dueDate"))
        if due_day is not None:
            due_date = due_day.isoformat()
            if not group["oldestDueDate"] or due_date < group["oldestDueDate"]:
                group["oldestDueDate"] = due_date
            if outstanding > 0 and due_day < report_day:
                group["overdueAmount"] = money(group["overdueAmount"] + outstanding)
                group["daysOverdue"] = max(group["daysOverdue"], (report_day - due_day).days)
                if not group["oldestOverdueDate"] or due_date < group["oldestOverdueDate"]:
                    group["oldestOverdueDate"] = due_date

        group["invoiceCount"] += 1
        invoice_number = clean_text(invoice.get("invoiceNumber"))
        if invoice_number and invoice_number not in group["invoiceNumbers"]:
            group["invoiceNumbers"].append(invoice_number)
        service_account_number = clean_text(invoice.get("serviceAccountNumber"))
        if service_account_number and service_account_number not in group["serviceAccountNumbers"]:
            group["serviceAccountNumbers"].append(service_account_number)
        for field_name, amount in (
            ("grossCharges", gross_charges),
            ("invoiceCredits", credit_total),
            ("billedAmount", billed_amount),
            ("cashCollected", cash_collected),
            ("accountCreditsApplied", account_credits),
            ("rebatesApplied", rebates_applied),
            ("creditsApplied", money(credit_total + account_credits)),
            ("outstandingAmount", outstanding),
        ):
            group[field_name] = money(group[field_name] + amount)

    customer_rows: list[dict[str, Any]] = []
    for group in grouped.values():
        if group["outstandingAmount"] <= 0:
            collection_status = "FULLY_PAID"
        elif money(group["cashCollected"] + group["accountCreditsApplied"]) > 0:
            collection_status = "PARTIALLY_PAID"
        else:
            collection_status = "UNPAID"
        group["status"] = collection_status
        group["reconciliationVariance"] = money(
            group["billedAmount"]
            - group["cashCollected"]
            - group["accountCreditsApplied"]
            - group["outstandingAmount"]
        )
        customer_rows.append(group)

    status_order = {"UNPAID": 0, "PARTIALLY_PAID": 1, "FULLY_PAID": 2}
    customer_rows.sort(
        key=lambda row: (
            0 if money(row.get("overdueAmount")) > 0 else 1,
            -int(row.get("daysOverdue") or 0),
            status_order[row["status"]],
            -money(row.get("outstandingAmount")),
            customer_name(row.get("customer") or {}).lower(),
        )
    )

    billed_subscribers = len(customer_rows)
    fully_paid = sum(row["status"] == "FULLY_PAID" for row in customer_rows)
    partially_paid = sum(row["status"] == "PARTIALLY_PAID" for row in customer_rows)
    unpaid = sum(row["status"] == "UNPAID" for row in customer_rows)
    gross_charges = money(sum(row["grossCharges"] for row in customer_rows))
    invoice_credits = money(sum(row["invoiceCredits"] for row in customer_rows))
    billed_amount = money(sum(row["billedAmount"] for row in customer_rows))
    cash_collected = money(sum(row["cashCollected"] for row in customer_rows))
    account_credits = money(sum(row["accountCreditsApplied"] for row in customer_rows))
    rebates_applied = money(sum(row["rebatesApplied"] for row in customer_rows))
    outstanding = money(sum(row["outstandingAmount"] for row in customer_rows))
    reconciliation_variance = money(
        billed_amount - cash_collected - account_credits - outstanding
    )
    receivables = receivables_aging_summary(
        report_day,
        adjustments_by_invoice,
        cash_by_invoice,
        account_credit_by_invoice,
    )

    search_terms = clean_text(search).lower().split()
    filtered_rows = []
    for row in customer_rows:
        if normalized_status == "ACTION_REQUIRED" and row["status"] == "FULLY_PAID":
            continue
        if normalized_status not in {"ALL", "ACTION_REQUIRED"} and row["status"] != normalized_status:
            continue
        searchable = " ".join(
            [
                customer_name(row.get("customer") or {}),
                clean_text((row.get("customer") or {}).get("accountNumber")),
                clean_text((row.get("customer") or {}).get("contactNumber")),
                clean_text((row.get("customer") or {}).get("address")),
                row["customerId"],
                *row["invoiceNumbers"],
                *row["serviceAccountNumbers"],
            ]
        ).lower()
        if search_terms and not all(term in searchable for term in search_terms):
            continue
        filtered_rows.append(row)

    normalized_page_size = max(10, min(int(page_size or 20), 100))
    total_rows = len(filtered_rows)
    total_pages = max(1, ceil(total_rows / normalized_page_size))
    normalized_page = max(1, min(int(page or 1), total_pages))
    start_index = (normalized_page - 1) * normalized_page_size
    paginated_rows = filtered_rows[start_index:start_index + normalized_page_size]
    return {
        "billingMonth": period_key,
        "billingPeriodLabel": period_start.strftime("%B %Y"),
        "asOfDate": report_day.isoformat(),
        "timeZone": BILLING_TIMEZONE,
        "scope": "MONTHLY_SERVICE_INVOICES",
        "billedSubscriberCount": billed_subscribers,
        "fullyPaidSubscriberCount": fully_paid,
        "partiallyPaidSubscriberCount": partially_paid,
        "unpaidSubscriberCount": unpaid,
        "subscriberOutstandingCount": partially_paid + unpaid,
        "subscriberCollectionRate": round(
            (fully_paid / billed_subscribers) * 100,
            2,
        ) if billed_subscribers else 0.0,
        "subscriberCollectionRateApplicable": billed_subscribers > 0,
        "cashCollectionRate": round(
            (cash_collected / billed_amount) * 100,
            2,
        ) if billed_amount > 0 else 0.0,
        "cashCollectionRateApplicable": billed_amount > 0,
        "cohortInvoiceCount": sum(row["invoiceCount"] for row in customer_rows),
        "grossCharges": gross_charges,
        "invoiceCredits": invoice_credits,
        "netBilledAmount": billed_amount,
        "cashCollected": cash_collected,
        "accountCreditsApplied": account_credits,
        "creditsApplied": money(invoice_credits + account_credits),
        "rebatesApplied": rebates_applied,
        "outstandingAmount": outstanding,
        "reconciliationVariance": reconciliation_variance,
        "hasReconciliationException": abs(reconciliation_variance) >= 0.01,
        "receivables": receivables,
        "availableBillingMonths": sorted(available_months, reverse=True),
        "selectedStatus": normalized_status,
        "search": clean_text(search),
        "rows": paginated_rows,
        "pagination": {
            "page": normalized_page,
            "pageSize": normalized_page_size,
            "totalRows": total_rows,
            "totalPages": total_pages,
        },
        "definitions": {
            "subscriberUnit": "UNIQUE_CUSTOMER",
            "subscriberCollectionRate": "Fully settled billed customers divided by billed customers",
            "cashCollectionRate": "Posted cash receipt allocations divided by net billed amount",
            "creditTreatment": "Invoice and account credits are reported separately and never counted as cash",
            "receivablesAging": "Open invoice balance aged by due date as of the selected reporting date",
        },
        "generatedAt": now_iso(),
    }


def collection_billing_period(value: str | None) -> str:
    selected = clean_text(value)
    if not selected or normalize_upper(selected) == "ALL":
        return ""
    try:
        parsed = date.fromisoformat(f"{selected}-01")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="billingPeriod must be ALL or YYYY-MM") from exc
    if parsed.strftime("%Y-%m") != selected:
        raise HTTPException(status_code=400, detail="billingPeriod must be ALL or YYYY-MM")
    return selected


def collection_open_invoice_item(
    invoice: dict[str, Any],
    report_day: date,
    postings: dict[str, Any],
) -> dict[str, Any] | None:
    if not invoice_active_as_of(invoice, report_day):
        return None
    invoice_id = clean_text(invoice.get("id"))
    invoice_adjustments = postings["adjustmentsByInvoice"].get(invoice_id, [])
    subtotal = money(
        sum(item.get("amount", line_amount(item)) for item in invoice.get("lineItems", []))
    )
    debit_total = money(
        sum(row.get("amount") for row in invoice_adjustments if row.get("type") == "DEBIT")
    )
    credit_total = money(
        sum(row.get("amount") for row in invoice_adjustments if row.get("type") == "CREDIT")
    )
    direct_rebate_total = money(
        sum(
            row.get("amount")
            for row in invoice_adjustments
            if row.get("type") == "CREDIT" and row.get("adjustmentSource") == "SERVICE_REBATE"
        )
    )
    gross_charges = money(subtotal + debit_total)
    net_billed = money(max(0, gross_charges - credit_total))
    cash_collected = money(postings["cashByInvoice"].get(invoice_id, 0.0))
    account_credits = money(postings["accountCreditByInvoice"].get(invoice_id, 0.0))
    rebate_applied = money(
        direct_rebate_total + postings["rebateCreditByInvoice"].get(invoice_id, 0.0)
    )
    balance = money(max(0, net_billed - cash_collected - account_credits))
    if balance <= 0:
        return None

    due_day = reporting_record_day(invoice.get("dueDate"))
    days_overdue = max(0, (report_day - due_day).days) if due_day and due_day < report_day else 0
    settlement_amount = money(cash_collected + account_credits)
    payment_state = "PARTIALLY_PAID" if settlement_amount > 0 else "UNPAID"
    billing_period = invoice_billing_period(invoice)
    return {
        "id": invoice_id,
        "invoiceNumber": clean_text(invoice.get("invoiceNumber")),
        "customerId": clean_text(invoice.get("customerId")),
        "subscriptionId": clean_text(invoice.get("subscriptionId")),
        "serviceAccountNumber": clean_text(invoice.get("serviceAccountNumber")),
        "serviceId": clean_text(invoice.get("serviceId")),
        "invoiceType": normalize_upper(invoice.get("invoiceType")),
        "billingMode": normalize_upper(invoice.get("billingMode")),
        **billing_period,
        "issueDate": clean_text(invoice.get("issueDate")),
        "dueDate": clean_text(invoice.get("dueDate")),
        "grossCharges": gross_charges,
        "invoiceCredits": credit_total,
        "netBilledAmount": net_billed,
        "cashCollected": cash_collected,
        "accountCreditsApplied": account_credits,
        "rebatesApplied": rebate_applied,
        "settledAmount": settlement_amount,
        "balance": balance,
        "paymentState": payment_state,
        "collectionState": "OVERDUE" if days_overdue > 0 else payment_state,
        "daysOverdue": days_overdue,
        "isOverdue": days_overdue > 0,
    }


def collection_worklist_accounts(
    report_day: date,
    billing_period: str = "",
) -> tuple[list[dict[str, Any]], list[str]]:
    business_today = billing_business_date()
    if report_day > business_today:
        raise HTTPException(status_code=400, detail="asOf cannot be in the future")
    selected_period = collection_billing_period(billing_period)
    postings = collection_postings_as_of(report_day)
    grouped: dict[str, dict[str, Any]] = {}
    available_periods: set[str] = set()

    for invoice in visible_invoices():
        item = collection_open_invoice_item(invoice, report_day, postings)
        if item is None:
            continue
        period_key = clean_text(item.get("billingPeriodMonth"))
        if period_key:
            available_periods.add(period_key)
        if selected_period and period_key != selected_period:
            continue
        customer_id = clean_text(item.get("customerId"))
        if not customer_id:
            continue
        group = grouped.get(customer_id)
        if group is None:
            try:
                customer = resolve_customer(customer_id)
            except (HTTPException, KeyError, TypeError):
                customer = dict(invoice.get("customer") or billing_customer_snapshot(customer_id))
            group = {
                "customerId": customer_id,
                "customer": customer,
                "outstandingBalance": 0.0,
                "overdueBalance": 0.0,
                "currentBalance": 0.0,
                "openInvoiceCount": 0,
                "overdueInvoiceCount": 0,
                "partiallyPaidInvoiceCount": 0,
                "unpaidInvoiceCount": 0,
                "cashCollected": 0.0,
                "accountCreditsApplied": 0.0,
                "rebatesApplied": 0.0,
                "oldestDueDate": "",
                "oldestOverdueDate": "",
                "daysOverdue": 0,
                "openInvoices": [],
            }
            grouped[customer_id] = group

        group["openInvoices"].append(item)
        group["outstandingBalance"] = money(group["outstandingBalance"] + item["balance"])
        group["cashCollected"] = money(group["cashCollected"] + item["cashCollected"])
        group["accountCreditsApplied"] = money(
            group["accountCreditsApplied"] + item["accountCreditsApplied"]
        )
        group["rebatesApplied"] = money(group["rebatesApplied"] + item["rebatesApplied"])
        group["openInvoiceCount"] += 1
        if item["paymentState"] == "PARTIALLY_PAID":
            group["partiallyPaidInvoiceCount"] += 1
        else:
            group["unpaidInvoiceCount"] += 1
        due_date = clean_text(item.get("dueDate"))
        if due_date and (not group["oldestDueDate"] or due_date < group["oldestDueDate"]):
            group["oldestDueDate"] = due_date
        if item["isOverdue"]:
            group["overdueBalance"] = money(group["overdueBalance"] + item["balance"])
            group["overdueInvoiceCount"] += 1
            group["daysOverdue"] = max(group["daysOverdue"], item["daysOverdue"])
            if due_date and (
                not group["oldestOverdueDate"] or due_date < group["oldestOverdueDate"]
            ):
                group["oldestOverdueDate"] = due_date
        else:
            group["currentBalance"] = money(group["currentBalance"] + item["balance"])

    latest_payments = latest_posted_customer_payments(report_day)
    rows: list[dict[str, Any]] = []
    for group in grouped.values():
        group["openInvoices"].sort(
            key=lambda item: (
                0 if item.get("isOverdue") else 1,
                clean_text(item.get("dueDate")) or "9999-12-31",
                clean_text(item.get("invoiceNumber")),
            )
        )
        latest_payment = latest_payments.get(group["customerId"])
        group["invoiceNumbers"] = [item["invoiceNumber"] for item in group["openInvoices"]]
        group["billingPeriods"] = sorted(
            {item["billingPeriodMonth"] for item in group["openInvoices"] if item["billingPeriodMonth"]},
            reverse=True,
        )
        group["serviceAccountNumbers"] = sorted(
            {
                item["serviceAccountNumber"]
                for item in group["openInvoices"]
                if item["serviceAccountNumber"]
            }
        )
        group["actionRequired"] = bool(group["overdueInvoiceCount"])
        group["collectionStatus"] = (
            "OVERDUE"
            if group["overdueInvoiceCount"]
            else "PARTIALLY_PAID"
            if group["partiallyPaidInvoiceCount"]
            else "CURRENT"
        )
        group["lastPaymentDate"] = clean_text(latest_payment.get("paymentDate")) if latest_payment else ""
        group["lastPaymentAmount"] = money(latest_payment.get("amount")) if latest_payment else 0.0
        group["lastPaymentChannel"] = clean_text(latest_payment.get("collectionChannel")) if latest_payment else ""
        group["lastPaymentReceiptNumber"] = clean_text(latest_payment.get("receiptNumber")) if latest_payment else ""
        rows.append(group)

    rows.sort(
        key=lambda row: (
            0 if row["actionRequired"] else 1,
            0 if money(row.get("overdueBalance")) > 0 else 1,
            -int(row.get("daysOverdue") or 0),
            -money(row.get("overdueBalance")),
            -money(row.get("outstandingBalance")),
            customer_name(row.get("customer") or {}).lower(),
        )
    )
    return rows, sorted(available_periods, reverse=True)


def collection_worklist_status_match(row: dict[str, Any], status: str) -> bool:
    if status == "ALL_OPEN":
        return True
    if status == "ACTION_REQUIRED":
        return bool(row.get("actionRequired"))
    if status == "OVERDUE":
        return money(row.get("overdueBalance")) > 0
    if status == "PARTIALLY_PAID":
        return int(row.get("partiallyPaidInvoiceCount") or 0) > 0
    if status == "UNPAID":
        return int(row.get("unpaidInvoiceCount") or 0) > 0
    return False


def collection_worklist_report(
    as_of: date | None = None,
    billing_period: str = "",
    status: str = "ACTION_REQUIRED",
    search: str = "",
    page: int = 1,
    page_size: int = 20,
) -> dict[str, Any]:
    report_day = as_of or billing_business_date()
    selected_period = collection_billing_period(billing_period)
    normalized_status = normalize_upper(status or "ACTION_REQUIRED")
    if normalized_status not in COLLECTION_WORKLIST_STATUSES:
        raise HTTPException(
            status_code=400,
            detail="status must be ALL_OPEN, ACTION_REQUIRED, OVERDUE, PARTIALLY_PAID, or UNPAID",
        )
    account_rows, available_periods = collection_worklist_accounts(report_day, selected_period)
    summary = {
        "openCustomerCount": len(account_rows),
        "actionRequiredCustomerCount": sum(bool(row["actionRequired"]) for row in account_rows),
        "overdueCustomerCount": sum(money(row["overdueBalance"]) > 0 for row in account_rows),
        "openInvoiceCount": sum(int(row["openInvoiceCount"]) for row in account_rows),
        "overdueInvoiceCount": sum(int(row["overdueInvoiceCount"]) for row in account_rows),
        "openAmount": money(sum(row["outstandingBalance"] for row in account_rows)),
        "overdueAmount": money(sum(row["overdueBalance"] for row in account_rows)),
        "currentAmount": money(sum(row["currentBalance"] for row in account_rows)),
        "oldestDaysOverdue": max((int(row["daysOverdue"]) for row in account_rows), default=0),
    }

    search_terms = clean_text(search).lower().split()
    filtered_rows: list[dict[str, Any]] = []
    for row in account_rows:
        if not collection_worklist_status_match(row, normalized_status):
            continue
        searchable = " ".join(
            [
                customer_name(row.get("customer") or {}),
                clean_text((row.get("customer") or {}).get("accountNumber")),
                clean_text((row.get("customer") or {}).get("contactNumber")),
                clean_text((row.get("customer") or {}).get("address")),
                row["customerId"],
                *row["invoiceNumbers"],
                *row["billingPeriods"],
                *row["serviceAccountNumbers"],
            ]
        ).lower()
        if search_terms and not all(term in searchable for term in search_terms):
            continue
        filtered_rows.append(row)

    normalized_page_size = max(10, min(int(page_size or 20), 100))
    total_rows = len(filtered_rows)
    total_pages = max(1, ceil(total_rows / normalized_page_size))
    normalized_page = max(1, min(int(page or 1), total_pages))
    start_index = (normalized_page - 1) * normalized_page_size
    paginated_rows = filtered_rows[start_index:start_index + normalized_page_size]
    public_rows = [
        {key: value for key, value in row.items() if key != "openInvoices"}
        for row in paginated_rows
    ]
    period_label = (
        date.fromisoformat(f"{selected_period}-01").strftime("%B %Y")
        if selected_period
        else "All Open Billing Periods"
    )
    return {
        "scope": "ALL_OPEN_RECEIVABLES",
        "asOfDate": report_day.isoformat(),
        "timeZone": BILLING_TIMEZONE,
        "billingPeriod": selected_period or "ALL",
        "billingPeriodLabel": period_label,
        "availableBillingPeriods": available_periods,
        "selectedStatus": normalized_status,
        "search": clean_text(search),
        "summary": summary,
        "rows": public_rows,
        "pagination": {
            "page": normalized_page,
            "pageSize": normalized_page_size,
            "totalRows": total_rows,
            "totalPages": total_pages,
        },
        "definitions": {
            "worklistScope": "Every active invoice with a remaining balance as of the reporting date",
            "actionRequired": "Customer has at least one open invoice past its due date",
            "billingPeriodFilter": "Optional invoice-origin period filter; ALL is the operational default",
        },
        "generatedAt": now_iso(),
    }


def collection_account_detail(
    customer_id: str,
    as_of: date | None = None,
    billing_period: str = "",
) -> dict[str, Any]:
    report_day = as_of or billing_business_date()
    selected_period = collection_billing_period(billing_period)
    account_rows, _ = collection_worklist_accounts(report_day, selected_period)
    account = next((row for row in account_rows if row["customerId"] == customer_id), None)
    if account is None:
        raise HTTPException(status_code=404, detail="No open receivables found for this customer and scope")
    return {
        **account,
        "scope": "ALL_OPEN_RECEIVABLES",
        "asOfDate": report_day.isoformat(),
        "timeZone": BILLING_TIMEZONE,
        "billingPeriod": selected_period or "ALL",
        "generatedAt": now_iso(),
    }


def collection_account_rows(
    invoice_rows: list[dict[str, Any]] | None = None,
    as_of: date | None = None,
) -> list[dict[str, Any]]:
    """Group actionable open receivables by customer for the Billing overview."""
    business_day = as_of or billing_business_date()
    source_rows = invoice_rows if invoice_rows is not None else [invoice_summary(invoice) for invoice in visible_invoices()]
    grouped: dict[str, dict[str, Any]] = {}

    for invoice in source_rows:
        if invoice.get("status") in {"DRAFT", "PAID", "VOID"} or money(invoice.get("balance")) <= 0:
            continue
        customer_id = clean_text(invoice.get("customerId"))
        if not customer_id:
            continue
        group = grouped.get(customer_id)
        if group is None:
            try:
                customer = resolve_customer(customer_id)
            except HTTPException:
                customer = dict(invoice.get("customer") or {})
            group = {
                "customerId": customer_id,
                "customer": customer,
                "outstandingBalance": 0.0,
                "overdueBalance": 0.0,
                "partiallyPaidBalance": 0.0,
                "openInvoiceCount": 0,
                "overdueInvoiceCount": 0,
                "partiallyPaidInvoiceCount": 0,
                "oldestDueDate": "",
                "oldestOverdueDate": "",
                "daysOverdue": 0,
                "_openInvoices": [],
            }
            grouped[customer_id] = group

        balance = money(invoice.get("balance"))
        group["_openInvoices"].append(invoice)
        group["outstandingBalance"] = money(group["outstandingBalance"] + balance)
        group["openInvoiceCount"] += 1

        due_day: date | None = None
        due_value = clean_text(invoice.get("dueDate"))
        if due_value:
            try:
                due_day = parse_day(due_value, "dueDate")
            except HTTPException:
                due_day = None
        if due_day is not None:
            due_date = due_day.isoformat()
            if not group["oldestDueDate"] or due_date < group["oldestDueDate"]:
                group["oldestDueDate"] = due_date
            if due_day < business_day:
                group["overdueBalance"] = money(group["overdueBalance"] + balance)
                group["overdueInvoiceCount"] += 1
                group["daysOverdue"] = max(group["daysOverdue"], (business_day - due_day).days)
                if not group["oldestOverdueDate"] or due_date < group["oldestOverdueDate"]:
                    group["oldestOverdueDate"] = due_date

        if money(invoice.get("paidTotal")) > 0:
            group["partiallyPaidBalance"] = money(group["partiallyPaidBalance"] + balance)
            group["partiallyPaidInvoiceCount"] += 1

    latest_payments = latest_posted_customer_payments()
    rows: list[dict[str, Any]] = []
    for group in grouped.values():
        if group["overdueBalance"] <= 0 and group["partiallyPaidInvoiceCount"] <= 0:
            continue
        open_invoices = group.pop("_openInvoices")
        latest_payment = latest_payments.get(group["customerId"])
        rows.append(
            {
                **group,
                "collectionStatus": "OVERDUE" if group["overdueBalance"] > 0 else "PARTIALLY_PAID",
                **unpaid_month_summary(open_invoices),
                "lastPaymentDate": clean_text(latest_payment.get("paymentDate")) if latest_payment else "",
                "lastPaymentAmount": money(latest_payment.get("amount")) if latest_payment else 0.0,
                "lastPaymentChannel": clean_text(latest_payment.get("collectionChannel")) if latest_payment else "",
                "lastPaymentPostedByName": clean_text(latest_payment.get("postedByName")) if latest_payment else "",
                "lastPaymentReceiptNumber": clean_text(latest_payment.get("receiptNumber")) if latest_payment else "",
            }
        )

    return sorted(
        rows,
        key=lambda row: (
            0 if money(row.get("overdueBalance")) > 0 else 1,
            -int(row.get("daysOverdue") or 0),
            -money(row.get("overdueBalance")),
            -money(row.get("outstandingBalance")),
            customer_name(row.get("customer") or {}).lower(),
        ),
    )


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


@billing_read_snapshot
def collector_aging_accounts(search: str = "") -> list[dict[str, Any]]:
    """Return active customer accounts, open invoices, and available credit for Collector."""
    seed_billing_data()
    payment_day = billing_business_date()
    grouped: dict[str, dict[str, Any]] = {}
    for invoice in visible_invoices():
        summary = invoice_summary(invoice)
        if summary.get("status") in {"DRAFT", "PAID", "VOID"} or money(summary.get("balance")) <= 0:
            continue
        customer_id = clean_text(summary.get("customerId"))
        if not customer_id:
            continue
        group = grouped.get(customer_id)
        if group is None:
            try:
                customer = resolve_customer(customer_id)
            except HTTPException:
                customer = dict(summary.get("customer") or {})
            group = {
                "customerId": customer_id,
                "customer": customer,
                "outstandingBalance": 0.0,
                "promotionDiscountTotal": 0.0,
                "payableToday": 0.0,
                "paymentDate": payment_day.isoformat(),
                "overdueBalance": 0.0,
                "openInvoiceCount": 0,
                "overdueInvoiceCount": 0,
                "oldestDueDate": "",
                "accountCredit": customer_credit_balance(customer_id),
                "invoices": [],
            }
            grouped[customer_id] = group
        promotion_quote = payment_promotion_quote(invoice, payment_day)
        invoice_row = {
            "id": summary["id"],
            "invoiceNumber": summary.get("invoiceNumber") or "",
            "status": summary.get("status") or "",
            "issueDate": summary.get("issueDate") or "",
            "dueDate": summary.get("dueDate") or "",
            "billingCycleStart": summary.get("billingCycleStart") or "",
            "billingCycleEnd": summary.get("billingCycleEnd") or "",
            "invoiceType": summary.get("invoiceType") or "",
            "catalogName": summary.get("catalogName") or "",
            "serviceAccountNumber": summary.get("serviceAccountNumber") or "",
            "serviceId": summary.get("serviceId") or "",
            "lineItems": summary.get("lineItems") or [],
            "total": money(summary.get("total")),
            "paidTotal": money(summary.get("paidTotal")),
            "balance": money(summary.get("balance")),
            "promotionQuote": promotion_quote,
        }
        group["invoices"].append(invoice_row)
        group["outstandingBalance"] = money(group["outstandingBalance"] + invoice_row["balance"])
        group["promotionDiscountTotal"] = money(
            group["promotionDiscountTotal"] + promotion_quote["promotionDiscountAmount"]
        )
        group["payableToday"] = money(
            group["payableToday"] + promotion_quote["discountedPayable"]
        )
        group["openInvoiceCount"] += 1
        if invoice_row["status"] == "OVERDUE":
            group["overdueBalance"] = money(group["overdueBalance"] + invoice_row["balance"])
            group["overdueInvoiceCount"] += 1
        due_date = clean_text(invoice_row["dueDate"])
        if due_date and (not group["oldestDueDate"] or due_date < group["oldestDueDate"]):
            group["oldestDueDate"] = due_date

    for subscription in visible_subscriptions():
        if subscription.get("status") != "ACTIVE":
            continue
        customer_id = clean_text(subscription.get("customerId"))
        if not customer_id or customer_id in grouped:
            continue
        try:
            customer = resolve_customer(customer_id)
        except HTTPException:
            customer = dict(subscription.get("customer") or {})
        grouped[customer_id] = {
            "customerId": customer_id,
            "customer": customer,
            "outstandingBalance": 0.0,
            "promotionDiscountTotal": 0.0,
            "payableToday": 0.0,
            "paymentDate": payment_day.isoformat(),
            "overdueBalance": 0.0,
            "openInvoiceCount": 0,
            "overdueInvoiceCount": 0,
            "oldestDueDate": "",
            "accountCredit": customer_credit_balance(customer_id),
            "invoices": [],
        }

    rows = list(grouped.values())
    for row in rows:
        row["invoices"].sort(
            key=lambda invoice: (
                invoice.get("dueDate") or "9999-12-31",
                invoice.get("invoiceNumber") or "",
            )
        )
    needle = clean_text(search).lower()
    if needle:
        rows = [
            row
            for row in rows
            if any(
                needle in clean_text(value).lower()
                for value in [
                    row["customer"].get("name"),
                    row["customer"].get("accountNumber"),
                    row["customer"].get("contactNumber"),
                    row["customer"].get("address"),
                ]
            )
            or any(
                needle in clean_text(invoice.get("invoiceNumber")).lower()
                for invoice in row["invoices"]
            )
        ]
    return sorted(
        rows,
        key=lambda row: (
            0 if money(row.get("overdueBalance")) > 0 else 1,
            row.get("oldestDueDate") or "9999-12-31",
            clean_text((row.get("customer") or {}).get("name")).lower(),
        ),
    )


def early_bird_invoice_fields(
    subscription: dict[str, Any],
    cycle_start_day: date,
    invoice_type: str,
    due_day: date | None = None,
) -> dict[str, Any]:
    qualified_promotion_ids = normalized_promotion_ids(
        subscription.get("qualifiedPromotionIds"),
        "qualified promotion IDs",
    )
    if not qualified_promotion_ids:
        legacy_promotion_id = clean_text(subscription.get("earlyBirdPromotionId"))
        if clean_bool(subscription.get("earlyBirdEligible")) and legacy_promotion_id:
            qualified_promotion_ids = [legacy_promotion_id]

    qualified_promotions: list[dict[str, Any]] = []
    if subscription.get("billingMode") in BILLING_MODES and invoice_type == "MONTHLY":
        for promotion_id in qualified_promotion_ids:
            try:
                promotion = find_promotion(promotion_id)
            except HTTPException:
                continue
            promotion_valid = bool(
                promotion.get("appliesTo") == "MONTHLY_SERVICE"
                and promotion_payment_rule(promotion) in PROMOTION_PAYMENT_RULES
                and promotion_is_active(promotion, cycle_start_day)
                and not clean_bool(promotion.get("requiresApproval"))
                and (not promotion.get("billingMode") or promotion.get("billingMode") == subscription.get("billingMode"))
            )
            if promotion_valid:
                qualified_promotions.append(promotion)
    qualified_promotions.sort(key=promotion_order_key)
    try:
        validate_promotion_stack(qualified_promotions)
    except HTTPException:
        qualified_promotions = []

    base_amount = money(subscription.get("monthlyRate"))
    snapshots = [
        promotion_qualification_snapshot(promotion, base_amount)
        for promotion in qualified_promotions
    ]
    early_bird_promotion = next(
        (promotion for promotion in qualified_promotions if promotion_payment_rule(promotion) == "EARLY_BIRD"),
        None,
    )
    eligible = early_bird_promotion is not None
    promotion_id = early_bird_promotion["id"] if early_bird_promotion else ""
    promotion_code = clean_text(early_bird_promotion.get("promoCode")) if early_bird_promotion else ""
    promotion_name = clean_text(early_bird_promotion.get("name")) if early_bird_promotion else ""
    discount_amount = (
        promotion_discount_amount(early_bird_promotion, base_amount)
        if early_bird_promotion
        else 0
    )
    if subscription.get("billingMode") == "POSTPAID" and due_day:
        cutoff_day = due_day + timedelta(days=1)
    else:
        cutoff_day = cycle_start_day
    return {
        "qualifiedPromotionIds": [promotion["id"] for promotion in qualified_promotions],
        "qualifiedPromotions": snapshots,
        "qualifiedPromotionCount": len(snapshots),
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


def subscription_invoice_due_date(
    subscription: dict[str, Any],
    cycle_start: date,
    cycle_end: date,
    issue_day: date,
) -> date:
    if normalize_upper(subscription.get("billingMode")) == "PREPAID":
        return max(cycle_start, issue_day)
    due_base = max(cycle_end, issue_day)
    return due_base + timedelta(days=int(subscription.get("dueDays") or 0))


def create_invoice_from_subscription(
    subscription: dict[str, Any],
    cycle_start: str | None = None,
    idempotency_key: str = "",
    credit_actor: str = "system",
    generated_on: date | None = None,
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
    issue_day = generated_on or billing_business_date()
    due_day = subscription_invoice_due_date(subscription, cycle_start_day, cycle_end_day, issue_day)
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
        "lineItems": normalize_line_items(
            None,
            subscription,
            billing_period_label=cycle_start_day.strftime("%B %Y"),
        ),
        "notes": "",
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": None,
    }
    invoices.append(invoice)
    apply_available_customer_credit(invoice, credit_actor)
    capture_invoice_account_summary_at_issue(invoice)
    subscription["nextInvoiceDate"] = (cycle_end_day + timedelta(days=1)).isoformat()
    subscription["updatedAt"] = timestamp
    return invoice_summary(invoice)


def billing_cycle_generation_date(subscription: dict[str, Any], cycle_start: date) -> date:
    if normalize_upper(subscription.get("billingMode")) == "PREPAID":
        return cycle_start - timedelta(days=BILLING_PREPAID_LEAD_DAYS)
    return month_end(cycle_start)


def billing_cycle_ready(subscription: dict[str, Any], cycle_start: date, as_of: date) -> bool:
    return billing_cycle_generation_date(subscription, cycle_start) <= as_of


def billing_run_preview_data(as_of: date) -> dict[str, Any]:
    ensure_billing_data_loaded()
    rows: list[dict[str, Any]] = []
    invalid_rows: list[dict[str, Any]] = []
    for subscription in visible_subscriptions():
        if normalize_upper(subscription.get("status")) != "ACTIVE":
            continue
        try:
            cycle_start = parse_day(
                subscription.get("nextInvoiceDate") or subscription.get("startDate"),
                "nextInvoiceDate",
            )
            due_cycles = 0
            first_generation_date = billing_cycle_generation_date(subscription, cycle_start)
            cursor = cycle_start
            for _ in range(MAX_BILLING_CATCHUP_CYCLES):
                if not billing_cycle_ready(subscription, cursor, as_of):
                    break
                due_cycles += 1
                cursor = next_month_start(cursor)
            if not due_cycles:
                continue
            customer = subscription.get("customer") if isinstance(subscription.get("customer"), dict) else {}
            rows.append(
                {
                    "subscriptionId": subscription["id"],
                    "customerId": subscription.get("customerId", ""),
                    "accountNumber": customer.get("accountNumber", ""),
                    "customerName": clean_text(
                        " ".join(
                            clean_text(part)
                            for part in [customer.get("firstName"), customer.get("lastName")]
                            if clean_text(part)
                        )
                        or customer.get("fullName")
                        or customer.get("name")
                    ),
                    "planName": subscription.get("planName", ""),
                    "billingMode": normalize_upper(subscription.get("billingMode")),
                    "nextCycleStart": cycle_start.isoformat(),
                    "nextGenerationDate": first_generation_date.isoformat(),
                    "dueCycles": due_cycles,
                    "estimatedAmount": money(due_cycles * money(subscription.get("monthlyRate"))),
                }
            )
        except (HTTPException, TypeError, ValueError) as exc:
            detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
            invalid_rows.append(
                {
                    "subscriptionId": subscription.get("id", ""),
                    "nextInvoiceDate": subscription.get("nextInvoiceDate", ""),
                    "error": clean_text(detail)[:500] or "Invalid billing schedule",
                }
            )
    return {
        "businessDate": as_of.isoformat(),
        "dueSubscriptions": len(rows),
        "dueCycles": sum(row["dueCycles"] for row in rows),
        "estimatedAmount": money(sum(row["estimatedAmount"] for row in rows)),
        "prepaidCycles": sum(row["dueCycles"] for row in rows if row["billingMode"] == "PREPAID"),
        "postpaidCycles": sum(row["dueCycles"] for row in rows if row["billingMode"] == "POSTPAID"),
        "invalidSubscriptions": invalid_rows,
        "subscriptions": sorted(rows, key=lambda row: (row["nextGenerationDate"], row["subscriptionId"])),
    }


def billing_run_summary(run: dict[str, Any]) -> dict[str, Any]:
    summary = deepcopy(run)
    summary["items"] = sorted(
        summary.get("items") or [],
        key=lambda item: (item.get("cycleStart", ""), item.get("subscriptionId", "")),
    )
    return summary


def billing_run_by_idempotency_key(idempotency_key: str) -> dict[str, Any] | None:
    return next(
        (run for run in billing_runs if run.get("idempotencyKey") == idempotency_key and not run.get("deletedAt")),
        None,
    )


def billing_run_error_detail(exc: Exception) -> str:
    detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
    if isinstance(detail, (dict, list)):
        detail = json.dumps(detail, sort_keys=True)
    return clean_text(detail)[:500] or exc.__class__.__name__


def upsert_billing_run_item(run: dict[str, Any], item: dict[str, Any]) -> None:
    items = run.setdefault("items", [])
    for current in items:
        if current.get("itemKey") == item["itemKey"]:
            current.update(item)
            return
    items.append(item)


def begin_billing_run(
    as_of: date,
    run_type: str,
    actor: str,
    idempotency_key: str,
) -> tuple[dict[str, Any], list[str], list[str], bool]:
    with billing_store.transaction():
        preview = billing_run_preview_data(as_of)
        existing = billing_run_by_idempotency_key(idempotency_key)
        fingerprint = posting_fingerprint(
            "billing_run",
            {"businessDate": as_of.isoformat(), "runType": run_type},
        )
        if existing is not None and existing.get("idempotencyFingerprint") != fingerprint:
            raise HTTPException(status_code=409, detail="Idempotency-Key was already used for a different billing run")
        has_candidates = bool(preview["dueCycles"] or preview["invalidSubscriptions"])
        if existing is not None and (
            (run_type == "MANUAL" and existing.get("status") in BILLING_RUN_STATUSES[1:])
            or (run_type == "AUTOMATIC" and existing.get("status") in BILLING_RUN_STATUSES[1:] and not has_candidates)
        ):
            return billing_run_summary(existing), [], [], True

        timestamp = now_iso()
        if existing is None:
            run_id = str(uuid4())
            run_number = (
                f"BR-{as_of.strftime('%Y%m%d')}-AUTO"
                if run_type == "AUTOMATIC"
                else f"BR-{as_of.strftime('%Y%m%d')}-{run_id[:8].upper()}"
            )
            run = {
                "id": run_id,
                "runNumber": run_number,
                "idempotencyKey": idempotency_key,
                "idempotencyFingerprint": fingerprint,
                "runType": run_type,
                "businessDate": as_of.isoformat(),
                "status": "RUNNING",
                "attemptCount": 0,
                "eligibleSubscriptions": 0,
                "candidateCycles": 0,
                "invoicesCreated": 0,
                "invoicesReplayed": 0,
                "failedCycles": 0,
                "resolvedFailures": 0,
                "remainingDueCycles": 0,
                "totalAmount": 0.0,
                "items": [],
                "startedAt": timestamp,
                "finishedAt": "",
                "lastAttemptAt": timestamp,
                "createdByUsername": actor,
                "createdAt": timestamp,
                "updatedAt": timestamp,
                "deletedAt": None,
            }
            billing_runs.append(run)
        else:
            run = existing
            run["status"] = "RUNNING"
            run["lastAttemptAt"] = timestamp
            run["finishedAt"] = ""
            run["updatedAt"] = timestamp
        run["attemptCount"] = int(run.get("attemptCount") or 0) + 1
        run["eligibleSubscriptions"] = preview["dueSubscriptions"]
        run["candidateCycles"] = preview["dueCycles"]
        run["lastAttemptByUsername"] = actor
        add_audit(
            "billing_run_started",
            "BillingRun",
            run["id"],
            {
                "runNumber": run["runNumber"],
                "runType": run_type,
                "businessDate": as_of.isoformat(),
                "candidateCycles": preview["dueCycles"],
            },
            actor,
        )
        persist_billing_state()
        return (
            billing_run_summary(run),
            [row["subscriptionId"] for row in preview["subscriptions"]],
            [row["subscriptionId"] for row in preview["invalidSubscriptions"]],
            False,
        )


def process_next_billing_cycle(
    run_id: str,
    subscription_id: str,
    as_of: date,
    actor: str,
    generated_on: date,
) -> dict[str, Any] | None:
    with billing_store.transaction():
        run = find_billing_run(run_id)
        subscription = find_subscription(subscription_id)
        if normalize_upper(subscription.get("status")) != "ACTIVE":
            return None
        cycle_start = parse_day(
            subscription.get("nextInvoiceDate") or subscription.get("startDate"),
            "nextInvoiceDate",
        )
        if not billing_cycle_ready(subscription, cycle_start, as_of):
            return None
        cycle_value = cycle_start.isoformat()
        invoice = create_invoice_from_subscription(
            subscription,
            cycle_value,
            f"subscription-cycle:{subscription_id}:{cycle_value}",
            credit_actor=actor,
            generated_on=generated_on,
        )
        replayed = bool(invoice.get("idempotentReplay"))
        if replayed and parse_day(subscription.get("nextInvoiceDate"), "nextInvoiceDate") <= cycle_start:
            subscription["nextInvoiceDate"] = next_month_start(cycle_start).isoformat()
            subscription["updatedAt"] = now_iso()
        timestamp = now_iso()
        for previous in run.get("items") or []:
            if previous.get("subscriptionId") == subscription_id and previous.get("status") == "FAILED":
                previous["status"] = "RESOLVED"
                previous["resolvedAt"] = timestamp
                previous["resolvedByCycle"] = cycle_value
        upsert_billing_run_item(
            run,
            {
                "itemKey": f"{subscription_id}:{cycle_value}",
                "subscriptionId": subscription_id,
                "customerId": subscription.get("customerId", ""),
                "serviceAccountId": subscription.get("serviceAccountId", ""),
                "planName": subscription.get("planName", ""),
                "billingMode": subscription.get("billingMode", ""),
                "cycleStart": cycle_value,
                "cycleEnd": invoice.get("billingCycleEnd", ""),
                "generationDate": billing_cycle_generation_date(subscription, cycle_start).isoformat(),
                "status": "REPLAYED" if replayed else "CREATED",
                "invoiceId": invoice["id"],
                "invoiceNumber": invoice.get("invoiceNumber", ""),
                "amount": money(invoice.get("total")),
                "attemptCount": int(
                    next(
                        (
                            item.get("attemptCount") or 0
                            for item in run.get("items") or []
                            if item.get("itemKey") == f"{subscription_id}:{cycle_value}"
                        ),
                        0,
                    )
                )
                + 1,
                "lastAttemptAt": timestamp,
                "error": "",
            },
        )
        run["updatedAt"] = timestamp
        if not replayed:
            add_audit(
                "billing_invoice_generated",
                "BillingInvoice",
                invoice["id"],
                {
                    "subscriptionId": subscription_id,
                    "billingCycleStart": cycle_value,
                    "billingRunId": run_id,
                    "source": "AUTOMATIC_BILLING_RUN" if run.get("runType") == "AUTOMATIC" else "MANUAL_BILLING_RUN",
                },
                actor,
            )
        persist_billing_state()
        return {
            "subscriptionId": subscription_id,
            "cycleStart": cycle_value,
            "invoiceId": invoice["id"],
            "replayed": replayed,
        }


def record_billing_run_failure(run_id: str, subscription_id: str, actor: str, exc: Exception) -> None:
    with billing_store.transaction():
        run = find_billing_run(run_id)
        subscription = next(
            (row for row in subscriptions if row.get("id") == subscription_id and not row.get("deletedAt")),
            {},
        )
        cycle_value = clean_text(subscription.get("nextInvoiceDate") or subscription.get("startDate") or "UNKNOWN")
        item_key = f"{subscription_id}:{cycle_value}"
        current_attempts = next(
            (
                int(item.get("attemptCount") or 0)
                for item in run.get("items") or []
                if item.get("itemKey") == item_key
            ),
            0,
        )
        timestamp = now_iso()
        upsert_billing_run_item(
            run,
            {
                "itemKey": item_key,
                "subscriptionId": subscription_id,
                "customerId": subscription.get("customerId", ""),
                "serviceAccountId": subscription.get("serviceAccountId", ""),
                "planName": subscription.get("planName", ""),
                "billingMode": subscription.get("billingMode", ""),
                "cycleStart": cycle_value,
                "cycleEnd": "",
                "generationDate": "",
                "status": "FAILED",
                "invoiceId": "",
                "invoiceNumber": "",
                "amount": 0.0,
                "attemptCount": current_attempts + 1,
                "lastAttemptAt": timestamp,
                "error": billing_run_error_detail(exc),
            },
        )
        run["updatedAt"] = timestamp
        add_audit(
            "billing_run_item_failed",
            "BillingRun",
            run_id,
            {
                "subscriptionId": subscription_id,
                "billingCycleStart": cycle_value,
                "error": billing_run_error_detail(exc),
            },
            actor,
        )
        persist_billing_state()


def finalize_billing_run(run_id: str, as_of: date, actor: str) -> dict[str, Any]:
    with billing_store.transaction():
        run = find_billing_run(run_id)
        preview = billing_run_preview_data(as_of)
        items = run.get("items") or []
        created_items = [item for item in items if item.get("status") == "CREATED"]
        replayed_items = [item for item in items if item.get("status") == "REPLAYED"]
        failed_items = [item for item in items if item.get("status") == "FAILED"]
        resolved_items = [item for item in items if item.get("status") == "RESOLVED"]
        successful_items = [*created_items, *replayed_items]
        if failed_items:
            status = "PARTIAL_SUCCESS" if successful_items else "FAILED"
        elif preview["dueCycles"] or preview["invalidSubscriptions"]:
            status = "PARTIAL_SUCCESS"
        else:
            status = "COMPLETED"
        timestamp = now_iso()
        run.update(
            {
                "status": status,
                "invoicesCreated": len(created_items),
                "invoicesReplayed": len(replayed_items),
                "failedCycles": len(failed_items),
                "resolvedFailures": len(resolved_items),
                "remainingDueCycles": preview["dueCycles"] + len(preview["invalidSubscriptions"]),
                "totalAmount": money(sum(item.get("amount") or 0 for item in created_items)),
                "finishedAt": timestamp,
                "updatedAt": timestamp,
                "completedByUsername": actor,
            }
        )
        add_audit(
            "billing_run_completed",
            "BillingRun",
            run_id,
            {
                "status": status,
                "invoicesCreated": run["invoicesCreated"],
                "invoicesReplayed": run["invoicesReplayed"],
                "failedCycles": run["failedCycles"],
                "remainingDueCycles": run["remainingDueCycles"],
                "totalAmount": run["totalAmount"],
            },
            actor,
        )
        persist_billing_state()
        return billing_run_summary(run)


def execute_billing_run(
    as_of: date,
    run_type: str,
    actor: str,
    idempotency_key: str,
    generated_on: date | None = None,
) -> dict[str, Any]:
    normalized_type = normalize_upper(run_type)
    if normalized_type not in BILLING_RUN_TYPES:
        raise HTTPException(status_code=400, detail=f"runType must be one of {', '.join(BILLING_RUN_TYPES)}")
    run, subscription_ids, invalid_subscription_ids, replayed = begin_billing_run(
        as_of,
        normalized_type,
        actor,
        idempotency_key,
    )
    if replayed:
        return {**run, "idempotentReplay": True}
    issue_day = generated_on or billing_business_date()
    for subscription_id in invalid_subscription_ids:
        record_billing_run_failure(
            run["id"],
            subscription_id,
            actor,
            ValueError("Subscription has an invalid next invoice date"),
        )
    for subscription_id in subscription_ids:
        for _ in range(MAX_BILLING_CATCHUP_CYCLES):
            try:
                result = process_next_billing_cycle(run["id"], subscription_id, as_of, actor, issue_day)
            except Exception as exc:
                logger.exception(
                    "Billing run %s failed for subscription %s",
                    run["id"],
                    subscription_id,
                )
                record_billing_run_failure(run["id"], subscription_id, actor, exc)
                break
            if result is None:
                break
    return finalize_billing_run(run["id"], as_of, actor)


def billing_scheduler_status() -> dict[str, Any]:
    with _billing_scheduler_lock:
        thread = _billing_scheduler_thread
        return {
            "enabled": BILLING_AUTO_BILLER_ENABLED,
            "running": bool(thread and thread.is_alive()),
            "timezone": BILLING_TIMEZONE,
            "businessDate": billing_business_date().isoformat(),
            "prepaidLeadDays": BILLING_PREPAID_LEAD_DAYS,
            "intervalSeconds": BILLING_SCHEDULER_INTERVAL_SECONDS,
            **deepcopy(_billing_scheduler_state),
        }


def run_automatic_billing() -> dict[str, Any]:
    as_of = billing_business_date()
    return execute_billing_run(
        as_of,
        "AUTOMATIC",
        "system:automatic-biller",
        f"billing-run:auto:{as_of.isoformat()}",
    )


def billing_scheduler_loop() -> None:
    while not _billing_scheduler_stop.is_set():
        attempt_at = now_iso()
        with _billing_scheduler_lock:
            _billing_scheduler_state["lastAttemptAt"] = attempt_at
        try:
            run = run_automatic_billing()
            with _billing_scheduler_lock:
                _billing_scheduler_state.update(
                    {
                        "lastCompletedAt": now_iso(),
                        "lastRunId": run.get("id", ""),
                        "lastStatus": run.get("status", ""),
                        "lastError": "",
                    }
                )
        except Exception as exc:
            logger.exception("Automatic billing scheduler pass failed")
            with _billing_scheduler_lock:
                _billing_scheduler_state.update(
                    {
                        "lastStatus": "FAILED",
                        "lastError": billing_run_error_detail(exc),
                    }
                )
        _billing_scheduler_stop.wait(BILLING_SCHEDULER_INTERVAL_SECONDS)


def start_billing_scheduler() -> dict[str, Any]:
    global _billing_scheduler_thread
    with _billing_scheduler_lock:
        if not BILLING_AUTO_BILLER_ENABLED:
            return billing_scheduler_status()
        if _billing_scheduler_thread is not None and _billing_scheduler_thread.is_alive():
            return billing_scheduler_status()
        _billing_scheduler_stop.clear()
        _billing_scheduler_state["startedAt"] = now_iso()
        _billing_scheduler_thread = Thread(
            target=billing_scheduler_loop,
            name="billing-auto-biller",
            daemon=True,
        )
        _billing_scheduler_thread.start()
    return billing_scheduler_status()


def stop_billing_scheduler() -> dict[str, Any]:
    global _billing_scheduler_thread
    with _billing_scheduler_lock:
        thread = _billing_scheduler_thread
        _billing_scheduler_stop.set()
    if thread is not None and thread.is_alive():
        thread.join(timeout=5)
    with _billing_scheduler_lock:
        if thread is None or not thread.is_alive():
            _billing_scheduler_thread = None
    return billing_scheduler_status()


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


def create_first_subscription_invoice(
    subscription: dict[str, Any],
    credit_actor: str = "system",
) -> dict[str, Any] | None:
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
    issue_day = billing_business_date()
    due_day = subscription_invoice_due_date(
        subscription,
        details["cycleStart"],
        details["cycleEnd"],
        issue_day,
    )
    mode_label = "prepaid" if is_prepaid else "postpaid"
    description = f"{subscription['planName']} {'prorated ' if details['isProrated'] else ''}{mode_label} internet service"
    description = f"{description} ({details['cycleStart'].strftime('%B %Y')})"
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
        **early_bird_invoice_fields(subscription, details["cycleStart"], details["invoiceType"], due_day),
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
    apply_available_customer_credit(invoice, credit_actor)
    capture_invoice_account_summary_at_issue(invoice)
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
            or any(needle in str(allocation.get("invoiceNumber", "")).lower() for allocation in row.get("allocations", []))
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
        "billingRunTypes": BILLING_RUN_TYPES,
        "billingRunStatuses": BILLING_RUN_STATUSES,
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
        "automaticBilling": billing_scheduler_status(),
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
    collection_accounts = collection_account_rows(invoice_rows)
    return {
        "metrics": billing_metrics(),
        "recentInvoices": sorted(invoice_rows, key=lambda invoice: invoice["createdAt"], reverse=True)[:5],
        "recentPayments": sorted(visible_payments(), key=lambda payment: payment["createdAt"], reverse=True)[:5],
        "atRisk": [invoice for invoice in invoice_rows if invoice["status"] in ["OVERDUE", "PARTIALLY_PAID"]][:5],
        "collectionAccounts": collection_accounts[:10],
        "collectionAccountCount": len(collection_accounts),
    }


@router.get("/collection-performance")
@billing_read_snapshot
def get_monthly_collection_performance(
    billingMonth: str = "",
    asOf: str = "",
    status: str = "ALL",
    search: str = "",
    page: int = 1,
    pageSize: int = 20,
    admin=Depends(require_admin),
):
    seed_billing_data()
    report_day = parse_day(asOf, "asOf") if asOf else billing_business_date()
    return monthly_collection_performance(
        billing_month=billingMonth,
        as_of=report_day,
        status=status,
        search=search,
        page=page,
        page_size=pageSize,
    )


@router.get("/collections/worklist")
@billing_read_snapshot
def get_collection_worklist(
    asOf: str = "",
    billingPeriod: str = "",
    status: str = "ACTION_REQUIRED",
    search: str = "",
    page: int = 1,
    pageSize: int = 20,
    admin=Depends(require_admin),
):
    seed_billing_data()
    report_day = parse_day(asOf, "asOf") if asOf else billing_business_date()
    return collection_worklist_report(
        as_of=report_day,
        billing_period=billingPeriod,
        status=status,
        search=search,
        page=page,
        page_size=pageSize,
    )


@router.get("/collections/accounts/{customer_id}")
@billing_read_snapshot
def get_collection_account(
    customer_id: str,
    asOf: str = "",
    billingPeriod: str = "",
    admin=Depends(require_admin),
):
    seed_billing_data()
    report_day = parse_day(asOf, "asOf") if asOf else billing_business_date()
    return collection_account_detail(customer_id, report_day, billingPeriod)


@router.post("/collections/accounts/{customer_id}/follow-up-sms")
def send_collection_follow_up_sms(
    customer_id: str,
    payload: CollectionFollowUpSmsPayload,
    admin=Depends(require_admin),
):
    message_text = clean_text(payload.messageText)
    if not message_text:
        raise HTTPException(status_code=400, detail="SMS message text is required")
    if _sms_sender is None:
        raise HTTPException(status_code=503, detail="A2P Messaging provider is not configured")
    report_day = parse_day(payload.asOf, "asOf") if payload.asOf else billing_business_date()
    with billing_store.read_snapshot():
        seed_billing_data()
        account = collection_account_detail(customer_id, report_day)
        customer = dict(account.get("customer") or {})
        destination = clean_text(customer.get("contactNumber"))
        if not destination:
            raise HTTPException(status_code=400, detail="Customer has no saved mobile number")
        request_context = {
            "origin": "billing_collection_worklist",
            "customerId": customer_id,
            "accountNumber": clean_text(customer.get("accountNumber")),
            "asOfDate": report_day.isoformat(),
            "outstandingBalance": money(account.get("outstandingBalance")),
            "overdueBalance": money(account.get("overdueBalance")),
            "daysOverdue": int(account.get("daysOverdue") or 0),
            "invoiceIds": [item["id"] for item in account.get("openInvoices", [])],
            "invoiceNumbers": [item["invoiceNumber"] for item in account.get("openInvoices", [])],
        }

    sms_result = _sms_sender(
        destination=destination,
        message_text=message_text,
        source=COLLECTION_FOLLOW_UP_SMS_SENDER_ID,
        purpose="BILLING_COLLECTION_FOLLOW_UP",
        request_context=request_context,
        created_by_admin_id=admin.get("id") or admin["username"],
    )
    add_audit(
        "billing_collection_follow_up_sms_sent",
        "BillingCollectionAccount",
        customer_id,
        {
            "destination": sms_result.get("destination") or "",
            "messageId": sms_result.get("message_id") or "",
            "senderId": COLLECTION_FOLLOW_UP_SMS_SENDER_ID,
            "asOfDate": report_day.isoformat(),
            "outstandingBalance": request_context["outstandingBalance"],
            "overdueBalance": request_context["overdueBalance"],
            "invoiceCount": len(request_context["invoiceIds"]),
        },
        admin["username"],
    )
    return {
        "status": sms_result.get("status") or "SUCCESS",
        "customerId": customer_id,
        "destination": sms_result.get("destination") or "",
        "messageId": sms_result.get("message_id") or "",
        "senderId": COLLECTION_FOLLOW_UP_SMS_SENDER_ID,
        "sentAt": now_iso(),
    }


@router.get("/billing-runs/preview")
@billing_read_snapshot
def preview_billing_run(asOf: str | None = None, admin=Depends(require_admin)):
    as_of = parse_day(asOf or billing_business_date().isoformat(), "asOf")
    return {
        **billing_run_preview_data(as_of),
        "scheduler": billing_scheduler_status(),
    }


@router.get("/billing-runs")
@billing_read_snapshot
def list_billing_runs(
    status: str = "",
    runType: str = "",
    limit: int = 50,
    admin=Depends(require_admin),
):
    rows = visible_billing_runs()
    if status:
        rows = [run for run in rows if normalize_upper(run.get("status")) == normalize_upper(status)]
    if runType:
        rows = [run for run in rows if normalize_upper(run.get("runType")) == normalize_upper(runType)]
    capped_limit = max(1, min(int(limit or 50), 250))
    return [
        billing_run_summary(run)
        for run in sorted(rows, key=lambda row: row.get("createdAt", ""), reverse=True)[:capped_limit]
    ]


@router.post("/billing-runs/run")
def trigger_billing_run(
    payload: BillingRunPayload,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    admin=Depends(require_admin),
):
    posting_key = normalize_idempotency_key(idempotency_key, required=True)
    business_today = billing_business_date()
    as_of = parse_day(payload.asOf or business_today.isoformat(), "asOf")
    if as_of > business_today:
        raise HTTPException(status_code=400, detail="Billing runs cannot post future billing dates")
    return execute_billing_run(as_of, "MANUAL", admin["username"], posting_key)


@router.get("/billing-runs/{run_id}")
@billing_read_snapshot
def get_billing_run(run_id: str, admin=Depends(require_admin)):
    return billing_run_summary(find_billing_run(run_id))


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
    first_invoice = create_first_subscription_invoice(subscription, admin["username"])
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
        admin["username"],
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


@router.get("/invoices/{invoice_id}/pdf", response_class=Response)
@billing_read_snapshot
def download_invoice_pdf(invoice_id: str, admin=Depends(require_admin)):
    document = invoice_detail(find_invoice(invoice_id))
    pdf = render_invoice_pdf(document, generated_at=now_iso())
    invoice_number = clean_text(document.get("invoiceNumber")) or "invoice"
    filename_stem = "".join(
        character if character.isascii() and (character.isalnum() or character in "-_") else "_"
        for character in invoice_number
    ).strip("_") or "invoice"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename_stem}.pdf"',
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/invoices/{invoice_id}")
@billing_read_snapshot
def get_invoice(invoice_id: str, admin=Depends(require_admin)):
    return invoice_detail(find_invoice(invoice_id))


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
    requested_issue_day = parse_day(payload.issueDate, "issueDate")
    cycle_start = parse_day(payload.billingCycleStart or requested_issue_day.isoformat(), "billingCycleStart")
    cycle_end = parse_day(payload.billingCycleEnd or (add_months(cycle_start, 1) - timedelta(days=1)).isoformat(), "billingCycleEnd")
    if cycle_end < cycle_start:
        raise HTTPException(status_code=400, detail="billingCycleEnd cannot be before billingCycleStart")
    status = normalize_upper(payload.status or "ISSUED")
    if status not in INVOICE_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid invoice status")
    if status not in ["DRAFT", "ISSUED"]:
        raise HTTPException(status_code=400, detail="New invoices must be saved as DRAFT or ISSUED")
    issue_day = billing_business_date() if subscription and status == "ISSUED" else requested_issue_day
    due_day = (
        subscription_invoice_due_date(subscription, cycle_start, cycle_end, issue_day)
        if subscription and status == "ISSUED"
        else parse_day(payload.dueDate or cycle_end.isoformat(), "dueDate")
    )
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
        **(
            early_bird_invoice_fields(subscription, cycle_start, invoice_type, due_day)
            if subscription
            else {
                "qualifiedPromotionIds": [],
                "qualifiedPromotions": [],
                "qualifiedPromotionCount": 0,
                "earlyBirdEligible": False,
                "earlyBirdDiscountAmount": 0,
                "earlyBirdCutoffDate": "",
            }
        ),
        "billingCycleStart": cycle_start.isoformat(),
        "billingCycleEnd": cycle_end.isoformat(),
        "issueDate": issue_day.isoformat(),
        "dueDate": due_day.isoformat(),
        "status": status,
        "lineItems": normalize_line_items(
            payload.lineItems,
            subscription,
            billing_period_label=invoice_billing_period(
                {
                    "billingCycleStart": cycle_start.isoformat(),
                    "billingCycleEnd": cycle_end.isoformat(),
                }
            )["billingPeriodLabel"],
        ),
        "notes": payload.notes or "",
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": None,
    }
    invoices.append(invoice)
    if invoice.get("status") == "ISSUED" and invoice.get("invoiceType") in MONTHLY_INVOICE_TYPES:
        apply_available_customer_credit(invoice, admin["username"])
    if invoice.get("status") != "DRAFT":
        capture_invoice_account_summary_at_issue(invoice)
    add_audit("billing_invoice_created", "BillingInvoice", invoice["id"], {"customerId": customer["id"]}, admin["username"])
    persist_billing_state()
    return invoice_summary(invoice)


@router.patch("/invoices/{invoice_id}")
@billing_mutation
def update_invoice(invoice_id: str, payload: InvoicePayload, admin=Depends(require_admin)):
    current = find_invoice(invoice_id)
    if current.get("status") != "DRAFT":
        raise HTTPException(status_code=409, detail="Posted invoices are immutable; use a credit or debit adjustment for corrections")
    previous_status = current.get("status")
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
            current["qualifiedPromotionIds"] = []
            current["qualifiedPromotions"] = []
            current["qualifiedPromotionCount"] = 0
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
        if previous_status == "DRAFT" and current.get("status") == "ISSUED":
            issue_day = billing_business_date()
            cycle_start = parse_day(current.get("billingCycleStart"), "billingCycleStart")
            cycle_end = parse_day(current.get("billingCycleEnd"), "billingCycleEnd")
            current["issueDate"] = issue_day.isoformat()
            current["dueDate"] = subscription_invoice_due_date(
                subscription,
                cycle_start,
                cycle_end,
                issue_day,
            ).isoformat()
        current.update(early_bird_invoice_fields(
            subscription,
            parse_day(current.get("billingCycleStart"), "billingCycleStart"),
            current["invoiceType"],
            parse_day(current.get("dueDate"), "dueDate"),
        ))
    current["updatedAt"] = now_iso()
    if previous_status == "DRAFT" and current.get("status") == "ISSUED":
        if current.get("invoiceType") in MONTHLY_INVOICE_TYPES:
            apply_available_customer_credit(current, admin["username"])
        capture_invoice_account_summary_at_issue(current)
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
    payment_day = posted_payment_day(paymentDate)
    promotion_options = eligible_payment_promotions(invoice, payment_day)
    recommended_bundle = recommended_payment_promotion_bundle(invoice, promotion_options)
    recommended_promotions = recommended_bundle["promotions"] if recommended_bundle else []
    recommended_promotion = recommended_promotions[0] if recommended_promotions else None
    quote = payment_promotion_quote(invoice, payment_day)
    return {
        "invoice": invoice_summary(invoice),
        "paymentDate": payment_day.isoformat(),
        "promotionQuote": quote,
        "recommendedPromotionId": recommended_promotion["id"] if recommended_promotion else "",
        "recommendedPromotionIds": [promotion["id"] for promotion in recommended_promotions],
        "recommendedPromotionBundle": recommended_bundle or {
            "promotionIds": [],
            "promotions": [],
            "discountAmount": 0,
            "discountedPayable": money(invoice_summary(invoice)["balance"]),
        },
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
    payment_adjustments = payment.setdefault("earlyBirdDiscountAdjustments", [])
    payment_adjustments.append(
        {
            "invoiceId": invoice["id"],
            "invoiceNumber": invoice["invoiceNumber"],
            "adjustmentId": adjustment["id"],
            "amount": adjustment["amount"],
            "promotionId": invoice.get("earlyBirdPromotionId", ""),
            "promotionCode": promotion_code,
            "promotionName": promotion_name,
        }
    )
    adjustment_ids = payment.setdefault("earlyBirdDiscountAdjustmentIds", [])
    adjustment_ids.append(adjustment["id"])
    payment["earlyBirdDiscountApplied"] = True
    payment["earlyBirdDiscountAmount"] = money(money(payment.get("earlyBirdDiscountAmount")) + adjustment["amount"])
    payment["earlyBirdDiscountAdjustmentId"] = adjustment["id"] if len(adjustment_ids) == 1 else ""
    invoice["updatedAt"] = timestamp
    add_audit("billing_adjustment_posted", "BillingAdjustment", adjustment["id"], {"invoiceId": invoice["id"], "source": "EARLY_BIRD_DISCOUNT", "paymentId": payment["id"]}, admin["username"])
    return adjustment


def void_early_bird_discount_for_payment(
    payment: dict[str, Any],
    timestamp: str,
    admin: dict[str, Any],
) -> None:
    adjustment_ids = [clean_text(payment.get("earlyBirdDiscountAdjustmentId"))]
    adjustment_ids.extend(clean_text(row) for row in payment.get("earlyBirdDiscountAdjustmentIds") or [])
    adjustment_by_id: dict[str, dict[str, Any]] = {}
    for adjustment_id in adjustment_ids:
        if not adjustment_id:
            continue
        try:
            adjustment = find_adjustment(adjustment_id)
        except HTTPException:
            continue
        adjustment_by_id[adjustment["id"]] = adjustment
    for row in visible_adjustments():
        if (
            row.get("paymentId") == payment["id"]
            and row.get("adjustmentSource") == "EARLY_BIRD_DISCOUNT"
            and row.get("status") == "POSTED"
        ):
            adjustment_by_id[row["id"]] = row
    posted_adjustments = [row for row in adjustment_by_id.values() if row.get("status") == "POSTED"]
    if not posted_adjustments:
        return
    for adjustment in posted_adjustments:
        adjustment["status"] = "VOID"
        adjustment["voidedAt"] = timestamp
        adjustment["voidedByUsername"] = admin["username"]
        adjustment["voidReason"] = "Related payment voided"
        adjustment["updatedAt"] = timestamp
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
    payment["earlyBirdDiscountApplied"] = False
    payment["earlyBirdDiscountAmount"] = 0


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
    payment_adjustments = payment.setdefault("promotionDiscountAdjustments", [])
    payment_adjustments.append(
        {
            "invoiceId": invoice["id"],
            "invoiceNumber": invoice["invoiceNumber"],
            "adjustmentId": adjustment["id"],
            "promotionId": promotion_option["id"],
            "promotionCode": promotion_code,
            "promotionName": promotion_name,
            "amount": adjustment["amount"],
        }
    )
    adjustment_ids = payment.setdefault("promotionDiscountAdjustmentIds", [])
    adjustment_ids.append(adjustment["id"])
    promotion_ids = payment.setdefault("promotionIds", [])
    if promotion_option["id"] not in promotion_ids:
        promotion_ids.append(promotion_option["id"])
    payment["promotionDiscountApplied"] = True
    payment["promotionDiscountAmount"] = money(money(payment.get("promotionDiscountAmount")) + adjustment["amount"])
    payment["promotionDiscountAdjustmentId"] = adjustment["id"] if len(adjustment_ids) == 1 else ""
    payment["promotionId"] = promotion_option["id"] if len(promotion_ids) == 1 else ""
    payment["promotionCode"] = promotion_code if len(promotion_ids) == 1 else "MULTIPLE"
    payment["promotionName"] = promotion_name if len(promotion_ids) == 1 else "Multiple promotions"
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
    adjustment_ids = [clean_text(payment.get("promotionDiscountAdjustmentId"))]
    adjustment_ids.extend(clean_text(row) for row in payment.get("promotionDiscountAdjustmentIds") or [])
    adjustment_by_id: dict[str, dict[str, Any]] = {}
    for adjustment_id in adjustment_ids:
        if not adjustment_id:
            continue
        try:
            adjustment = find_adjustment(adjustment_id)
        except HTTPException:
            continue
        adjustment_by_id[adjustment["id"]] = adjustment
    for row in visible_adjustments():
        if (
            row.get("paymentId") == payment["id"]
            and row.get("adjustmentSource") == "PAYMENT_PROMOTION"
            and row.get("status") == "POSTED"
        ):
            adjustment_by_id[row["id"]] = row
    posted_adjustments = [row for row in adjustment_by_id.values() if row.get("status") == "POSTED"]
    if not posted_adjustments:
        return
    for adjustment in posted_adjustments:
        adjustment["status"] = "VOID"
        adjustment["voidedAt"] = timestamp
        adjustment["voidedByUsername"] = admin["username"]
        adjustment["voidReason"] = "Related payment voided"
        adjustment["updatedAt"] = timestamp
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
    payment["promotionDiscountApplied"] = False
    payment["promotionDiscountAmount"] = 0


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
    amount = money(payload.amount)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Payment amount must be greater than zero")
    advance_amount = money(payload.advanceAmount)
    if advance_amount < 0 or advance_amount > amount:
        raise HTTPException(status_code=400, detail="Advance credit must be between zero and the payment amount")
    method = normalize_upper(payload.method or "CASH")
    status = normalize_upper(payload.status or "POSTED")
    if method not in PAYMENT_METHODS:
        raise HTTPException(status_code=400, detail="Invalid payment method")
    if status not in PAYMENT_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid payment status")
    if status != "POSTED":
        raise HTTPException(status_code=400, detail="New payments must be posted; use the void action for reversals")
    payment_day = posted_payment_day(payload.paymentDate)
    for quoted_allocation in payload.allocations or []:
        quote_fingerprint = clean_text(quoted_allocation.promotionQuoteFingerprint)[:128]
        if not quote_fingerprint:
            continue
        quote_date = clean_text(quoted_allocation.promotionQuoteDate)[:20]
        allocation_invoice = find_invoice(clean_text(quoted_allocation.invoiceId))
        allocation_promotion_ids = normalized_promotion_ids(
            quoted_allocation.promotionIds,
            "allocation promotion IDs",
        )
        legacy_allocation_promotion_id = clean_text(quoted_allocation.promotionId)
        if (
            legacy_allocation_promotion_id
            and legacy_allocation_promotion_id not in allocation_promotion_ids
        ):
            allocation_promotion_ids.append(legacy_allocation_promotion_id)
        current_quote = payment_promotion_quote(allocation_invoice, payment_day)
        if quote_date != payment_day.isoformat():
            raise HTTPException(
                status_code=409,
                detail="Promotion quote date changed. Refresh the customer account before collecting payment",
            )
        if (
            quote_fingerprint != current_quote["quoteFingerprint"]
            or allocation_promotion_ids != current_quote["promotionIds"]
        ):
            raise HTTPException(
                status_code=409,
                detail="Promotion or invoice balance changed. Refresh the customer account before collecting payment",
            )
    selected_promotion_ids = normalized_promotion_ids(payload.promotionIds, "payment promotion IDs")
    legacy_selected_promotion_id = clean_text(payload.promotionId)
    if legacy_selected_promotion_id and legacy_selected_promotion_id not in selected_promotion_ids:
        selected_promotion_ids.append(legacy_selected_promotion_id)
    customer, allocations, invoice = normalize_payment_allocations(payload, amount, advance_amount)
    if selected_promotion_ids:
        if len(allocations) != 1:
            raise HTTPException(status_code=400, detail="Use allocation promotion IDs for multi-invoice payment promotions")
        allocations[0]["promotionIds"] = selected_promotion_ids
        allocations[0]["promotionId"] = selected_promotion_ids[0] if len(selected_promotion_ids) == 1 else ""
    allocation_payment_promotions: dict[str, list[dict[str, Any]]] = {}
    allocation_early_bird_discounts: dict[str, dict[str, Any]] = {}
    if status == "POSTED":
        for allocation in allocations:
            allocation_invoice = find_invoice(allocation["invoiceId"])
            allocation_promotion_ids = normalized_promotion_ids(
                allocation.get("promotionIds"),
                "allocation promotion IDs",
            )
            quote_fingerprint = clean_text(allocation.get("promotionQuoteFingerprint"))[:128]
            quote_date = clean_text(allocation.get("promotionQuoteDate"))[:20]
            if quote_fingerprint:
                if quote_date != payment_day.isoformat():
                    raise HTTPException(
                        status_code=409,
                        detail="Promotion quote date changed. Refresh the customer account before collecting payment",
                    )
                current_quote = payment_promotion_quote(allocation_invoice, payment_day)
                if (
                    quote_fingerprint != current_quote["quoteFingerprint"]
                    or allocation_promotion_ids != current_quote["promotionIds"]
                ):
                    raise HTTPException(
                        status_code=409,
                        detail="Promotion or invoice balance changed. Refresh the customer account before collecting payment",
                    )
            if allocation_promotion_ids:
                allocation_payment_promotions[allocation_invoice["id"]] = payment_promotions_for_payment(
                    allocation_invoice,
                    allocation_promotion_ids,
                    allocation["amount"],
                    payment_day,
                )
                allocation["promotionIds"] = [
                    promotion["id"]
                    for promotion in allocation_payment_promotions[allocation_invoice["id"]]
                ]
                allocation["promotionId"] = allocation["promotionIds"][0] if len(allocation["promotionIds"]) == 1 else ""
                continue
            automatic_promotions = automatic_payment_promotions_for_payment(
                allocation_invoice,
                allocation["amount"],
                payment_day,
            )
            if automatic_promotions:
                allocation_payment_promotions[allocation_invoice["id"]] = automatic_promotions
                allocation["promotionIds"] = [promotion["id"] for promotion in automatic_promotions]
                allocation["promotionId"] = allocation["promotionIds"][0] if len(allocation["promotionIds"]) == 1 else ""
                continue
            early_bird_discount = early_bird_discount_for_payment(allocation_invoice, allocation["amount"], payment_day)
            if early_bird_discount is not None:
                allocation_early_bird_discounts[allocation_invoice["id"]] = early_bird_discount

    if advance_amount > 0:
        allocation_by_invoice = {
            allocation["invoiceId"]: allocation
            for allocation in allocations
        }
        for open_invoice in visible_invoices():
            summary = invoice_summary(open_invoice)
            if (
                open_invoice.get("customerId") != customer["id"]
                or summary.get("status") in {"DRAFT", "PAID", "VOID"}
                or money(summary.get("balance")) <= 0
            ):
                continue
            allocation = allocation_by_invoice.get(open_invoice["id"])
            if allocation is None:
                raise HTTPException(
                    status_code=400,
                    detail="Advance credit can only be stored after all current invoice balances are fully paid",
                )
            promotion_discount = money(
                sum(
                    promotion.get("discountAmountForInvoice")
                    for promotion in allocation_payment_promotions.get(open_invoice["id"], [])
                )
            )
            early_bird_discount = money(
                (allocation_early_bird_discounts.get(open_invoice["id"]) or {}).get("amount")
            )
            settled_value = money(allocation["amount"] + promotion_discount + early_bird_discount)
            if settled_value != money(summary["balance"]):
                raise HTTPException(
                    status_code=400,
                    detail="Advance credit can only be stored after all current invoice balances are fully paid",
                )

    promotion_ids = [
        promotion["id"]
        for promotion_rows in allocation_payment_promotions.values()
        for promotion in promotion_rows
    ]
    if promotion_ids:
        selected_promotion_id = promotion_ids[0] if len(set(promotion_ids)) == 1 else ""
    else:
        selected_promotion_id = ""
    timestamp = now_iso()
    invoice_ids = [allocation["invoiceId"] for allocation in allocations]
    payment = {
        "id": str(uuid4()),
        "receiptNumber": next_number("OR", payments, "receiptNumber"),
        "idempotencyKey": posting_key,
        "idempotencyFingerprint": fingerprint,
        "invoiceId": invoice["id"] if invoice else None,
        "invoiceNumber": payment_invoice_label(allocations, advance_amount),
        "allocations": allocations,
        "allocationCount": len(allocations),
        "appliedAmount": money(amount - advance_amount),
        "advanceAmount": advance_amount,
        "customerId": customer["id"],
        "customer": customer,
        "amount": amount,
        "method": method,
        "paymentDate": payment_day.isoformat(),
        "referenceNumber": payload.referenceNumber or "",
        "collectionChannel": clean_text(payload.collectionChannel) or "BILLING",
        "postedByUsername": admin["username"],
        "postedByName": admin_display_name(admin),
        "postedAt": timestamp,
        "status": status,
        "earlyBirdDiscountApplied": False,
        "earlyBirdDiscountAmount": 0,
        "earlyBirdDiscountAdjustmentId": "",
        "promotionDiscountApplied": False,
        "promotionDiscountAmount": 0,
        "promotionDiscountAdjustmentId": "",
        "promotionId": selected_promotion_id,
        "promotionIds": list(dict.fromkeys(promotion_ids)),
        "promotionCode": "",
        "promotionName": "",
        "notes": payload.notes or "",
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": None,
    }
    payments.append(payment)
    payment["accountCreditAfter"] = customer_credit_balance(customer["id"])
    for allocation in allocations:
        allocation_invoice = find_invoice(allocation["invoiceId"])
        payment_promotions = allocation_payment_promotions.get(allocation_invoice["id"]) or []
        if payment_promotions:
            for payment_promotion in payment_promotions:
                create_payment_promotion_adjustment(allocation_invoice, payment, payment_promotion, admin, timestamp)
            continue
        early_bird_discount = allocation_early_bird_discounts.get(allocation_invoice["id"])
        if early_bird_discount is not None:
            create_early_bird_discount_adjustment(allocation_invoice, payment, early_bird_discount, admin, timestamp)
    if invoice is not None:
        invoice["updatedAt"] = timestamp
    for invoice_id in invoice_ids:
        find_invoice(invoice_id)["updatedAt"] = timestamp
    add_audit(
        "billing_payment_posted",
        "BillingPayment",
        payment["id"],
        {
            "customerId": customer["id"],
            "invoiceId": payment["invoiceId"],
            "invoiceIds": invoice_ids,
            "allocationCount": len(allocations),
            "appliedAmount": payment["appliedAmount"],
            "advanceAmount": advance_amount,
            "accountCreditAfter": payment["accountCreditAfter"],
            "postedAt": timestamp,
        },
        admin["username"],
    )
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
    applied_credit_rows = credit_applications_for_payment(current["id"])
    if applied_credit_rows:
        raise HTTPException(
            status_code=409,
            detail="This advance receipt has already been applied to an invoice and cannot be voided",
        )
    timestamp = now_iso()
    current["status"] = "VOID"
    current["voidedAt"] = timestamp
    current["voidedByUsername"] = admin["username"]
    current["voidReason"] = clean_text(reason) or "Voided by POS or Billing user"
    current["updatedAt"] = timestamp
    void_early_bird_discount_for_payment(current, timestamp, admin)
    void_payment_promotion_for_payment(current, timestamp, admin)
    invoice_ids = payment_invoice_ids(current)
    for invoice_id in invoice_ids:
        find_invoice(invoice_id)["updatedAt"] = timestamp
    add_audit(
        "billing_payment_voided",
        "BillingPayment",
        current["id"],
        {
            "customerId": current["customerId"],
            "invoiceId": current.get("invoiceId"),
            "invoiceIds": invoice_ids,
            "reason": current["voidReason"],
        },
        admin["username"],
    )
    persist_billing_state()
    return {"status": "ok"}


def post_collector_payment(
    payload: dict[str, Any],
    idempotency_key: str,
    actor: dict[str, Any],
) -> dict[str, Any]:
    """Post a Collector receipt through Billing's canonical transaction path."""
    normalized_payload = dict(payload)
    normalized_payload["collectionChannel"] = "COLLECTOR"
    return create_payment(
        PaymentPayload(**normalized_payload),
        idempotency_key=idempotency_key,
        admin=actor,
    )


@router.post("/adjustments/outage-rebates/preview")
@billing_read_snapshot
def preview_outage_rebates(
    payload: OutageRebatePreviewPayload,
    admin=Depends(require_admin),
):
    seed_billing_data()
    return outage_rebate_quote(payload)


@router.post("/adjustments/outage-rebates")
@billing_mutation
def create_outage_rebate_batch(
    payload: OutageRebateBatchPayload,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    admin=Depends(require_admin),
):
    posting_key = normalize_idempotency_key(idempotency_key)
    customer_ids = normalize_outage_customer_ids(payload.customerIds)
    outage_start, outage_end = normalize_outage_window(payload.outageStart, payload.outageEnd)
    normalized_request = {
        "customerIds": customer_ids,
        "outageStart": outage_start.isoformat(),
        "outageEnd": outage_end.isoformat(),
        "previewFingerprint": clean_text(payload.previewFingerprint),
    }
    batch_fingerprint = posting_fingerprint("outage_rebate_batch", normalized_request)
    existing_batch = [
        adjustment
        for adjustment in visible_adjustments()
        if adjustment.get("outageBatchIdempotencyKey") == posting_key
    ]
    if existing_batch:
        if any(
            adjustment.get("outageBatchFingerprint") != batch_fingerprint
            for adjustment in existing_batch
        ):
            raise HTTPException(status_code=409, detail="Idempotency-Key was already used with a different outage rebate batch")
        return outage_rebate_batch_response(existing_batch, idempotent_replay=True)

    quote = outage_rebate_quote(payload)
    if not normalized_request["previewFingerprint"]:
        raise HTTPException(status_code=400, detail="previewFingerprint is required")
    if normalized_request["previewFingerprint"] != quote["quoteFingerprint"]:
        raise HTTPException(
            status_code=409,
            detail="Rebate preview changed. Review the recalculated amounts before posting",
        )
    if not quote["canPost"]:
        problems = [
            f"{customer_name(row['customer'])}: {row['ineligibleReason']}"
            for row in quote["rows"]
            if not row["eligible"]
        ]
        problem_summary = "; ".join(problems[:3])
        if len(problems) > 3:
            problem_summary = f"{problem_summary}; and {len(problems) - 3} more"
        raise HTTPException(
            status_code=409,
            detail=f"Cannot post outage rebate batch. {problem_summary}",
        )
    if money(quote["totalRebateAmount"]) <= 0:
        raise HTTPException(status_code=400, detail="The selected outage window produces no rebate")

    batch_id = str(uuid4())
    timestamp = now_iso()
    outage_label = (
        f"{outage_start.strftime('%b %d, %Y %I:%M %p')} to "
        f"{outage_end.strftime('%b %d, %Y %I:%M %p')} {BILLING_TIMEZONE}"
    )
    reason = f"Service outage rebate ({outage_label})"
    batch_adjustments: list[dict[str, Any]] = []
    for row in quote["rows"]:
        invoice = find_invoice(row["invoiceId"]) if row["invoiceId"] else None
        child_idempotency_key = (
            "outage:"
            + hashlib.sha256(f"{posting_key}|{row['customerId']}".encode("utf-8")).hexdigest()
        )
        child_fingerprint = posting_fingerprint(
            "adjustment",
            {
                "customerId": row["customerId"],
                "invoiceId": row["invoiceId"],
                "amount": row["rebateAmount"],
                "outageStart": quote["outageStart"],
                "outageEnd": quote["outageEnd"],
            },
        )
        adjustment = {
            "id": str(uuid4()),
            "idempotencyKey": child_idempotency_key,
            "idempotencyFingerprint": child_fingerprint,
            "invoiceId": "",
            "invoiceNumber": "",
            "customerId": row["customerId"],
            "customer": row["customer"],
            "type": "CREDIT",
            "amount": money(row["rebateAmount"]),
            "reason": reason,
            "adjustmentSource": "SERVICE_REBATE",
            "applicationMode": "CUSTOMER_ACCOUNT_CREDIT",
            "status": "POSTED",
            "notes": "Automatically calculated from active subscription rates and held as customer credit until applied.",
            "outageBatchId": batch_id,
            "outageBatchIdempotencyKey": posting_key,
            "outageBatchFingerprint": batch_fingerprint,
            "outageQuoteFingerprint": quote["quoteFingerprint"],
            "outageQuoteVersion": quote["version"],
            "outageStart": quote["outageStart"],
            "outageEnd": quote["outageEnd"],
            "outageTimezone": quote["timezone"],
            "outageDurationMinutes": quote["durationMinutes"],
            "outageDurationHours": quote["durationHours"],
            "outageCalculationMethod": quote["calculationMethod"],
            "outageMonthlyRecurringCharge": row["monthlyRecurringCharge"],
            "outageCalculatedAmount": row["calculatedAmount"],
            "outageApplyNowAmount": row["applyNowAmount"],
            "outageCarryForwardAmount": row["carryForwardAmount"],
            "outageApplicationMode": row["applicationMode"],
            "outageRebateCapped": False,
            "outageSubscriptions": deepcopy(row["subscriptions"]),
            "initialAppliedInvoiceId": invoice.get("id") if invoice else "",
            "initialAppliedInvoiceNumber": invoice.get("invoiceNumber") if invoice else "",
            "initialAppliedAmount": 0.0,
            "initialCreditApplicationIds": [],
            "postedByUsername": admin["username"],
            "postedByName": admin_display_name(admin),
            "createdAt": timestamp,
            "updatedAt": timestamp,
            "deletedAt": None,
        }
        adjustments.append(adjustment)
        batch_adjustments.append(adjustment)
        applied_rows = (
            apply_adjustment_credit_to_invoice(adjustment, invoice, admin["username"])
            if invoice is not None
            else []
        )
        applied_amount = money(sum(application.get("amount") for application in applied_rows))
        if applied_amount != money(row["applyNowAmount"]):
            raise HTTPException(
                status_code=409,
                detail="Customer balance changed while posting rebates. Refresh the preview and try again",
            )
        adjustment["initialAppliedAmount"] = applied_amount
        adjustment["initialCreditApplicationIds"] = [
            application["id"]
            for application in applied_rows
        ]
        add_audit(
            "billing_adjustment_posted",
            "BillingAdjustment",
            adjustment["id"],
            {
                "invoiceId": invoice.get("id") if invoice else "",
                "customerId": row["customerId"],
                "source": adjustment["adjustmentSource"],
                "amount": adjustment["amount"],
                "appliedAmount": applied_amount,
                "availableCredit": adjustment_credit_remaining(adjustment),
                "reason": adjustment["reason"],
                "outageBatchId": batch_id,
                "outageStart": quote["outageStart"],
                "outageEnd": quote["outageEnd"],
                "calculationMethod": quote["calculationMethod"],
            },
            admin["username"],
        )

    add_audit(
        "billing_outage_rebate_batch_posted",
        "BillingAdjustmentBatch",
        batch_id,
        {
            "customerCount": len(batch_adjustments),
            "totalRebateAmount": quote["totalRebateAmount"],
            "outageStart": quote["outageStart"],
            "outageEnd": quote["outageEnd"],
            "timezone": quote["timezone"],
            "durationMinutes": quote["durationMinutes"],
            "calculationMethod": quote["calculationMethod"],
            "totalAppliedAmount": money(
                sum(adjustment.get("initialAppliedAmount") for adjustment in batch_adjustments)
            ),
            "totalAvailableCredit": money(
                sum(adjustment_credit_remaining(adjustment) for adjustment in batch_adjustments)
            ),
            "adjustmentIds": [adjustment["id"] for adjustment in batch_adjustments],
        },
        admin["username"],
    )
    persist_billing_state()
    return outage_rebate_batch_response(batch_adjustments)


@router.get("/adjustments")
@billing_read_snapshot
def list_adjustments(customerId: str = "", admin=Depends(require_admin)):
    seed_billing_data()
    rows = visible_adjustments()
    if customerId:
        rows = [row for row in rows if row["customerId"] == customerId]
    return sorted(
        [adjustment_summary(row) for row in rows],
        key=lambda row: row["createdAt"],
        reverse=True,
    )


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
        return adjustment_summary(replay)

    invoice_id = clean_text(payload.invoiceId)
    customer_id = clean_text(payload.customerId)
    is_customer_rebate = bool(customer_id and not invoice_id)
    invoice = None
    invoice_state = None
    if invoice_id:
        invoice = find_invoice(invoice_id)
        if customer_id and invoice.get("customerId") != customer_id:
            raise HTTPException(status_code=400, detail="Selected invoice does not belong to the selected customer")
        customer = invoice.get("customer") or resolve_customer(invoice["customerId"])
        invoice_state = invoice_summary(invoice)
    elif customer_id:
        customer = resolve_customer(customer_id)
        try:
            invoice, invoice_state = customer_rebate_invoice(customer_id)
        except HTTPException as exc:
            if exc.status_code != 409:
                raise
    else:
        raise HTTPException(status_code=400, detail="customerId is required")

    invoice_status = invoice_state["status"] if invoice_state else ""
    if invoice is not None and invoice_status in ["DRAFT", "VOID"]:
        raise HTTPException(status_code=400, detail="Adjustments can only be posted to an issued invoice")
    adjustment_type = "CREDIT" if is_customer_rebate else normalize_upper(payload.type or "CREDIT")
    status = "POSTED" if is_customer_rebate else normalize_upper(payload.status or "POSTED")
    amount = money(payload.amount)
    reason = clean_text(payload.reason)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Adjustment amount must be greater than zero")
    if is_customer_rebate and not reason:
        raise HTTPException(status_code=400, detail="Rebate reason is required")
    if is_customer_rebate and payload.type and normalize_upper(payload.type) != "CREDIT":
        raise HTTPException(status_code=400, detail="Customer rebates must be credit adjustments")
    if is_customer_rebate and payload.status and normalize_upper(payload.status) != "POSTED":
        raise HTTPException(status_code=400, detail="Customer rebates must be posted immediately")
    if adjustment_type not in ADJUSTMENT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid adjustment type")
    if status not in ADJUSTMENT_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid adjustment status")
    if status != "POSTED":
        raise HTTPException(status_code=400, detail="New adjustments must be posted; use the void action for reversals")
    if not is_customer_rebate and adjustment_type == "CREDIT" and amount > invoice_amounts(invoice)["total"]:
        raise HTTPException(status_code=400, detail="Credit adjustment cannot exceed the invoice total")
    timestamp = now_iso()
    adjustment = {
        "id": str(uuid4()),
        "idempotencyKey": posting_key,
        "idempotencyFingerprint": fingerprint,
        "invoiceId": "" if is_customer_rebate else invoice["id"],
        "invoiceNumber": "" if is_customer_rebate else invoice["invoiceNumber"],
        "customerId": customer_id if is_customer_rebate else invoice["customerId"],
        "customer": customer,
        "type": adjustment_type,
        "amount": amount,
        "reason": reason or "Billing adjustment",
        "adjustmentSource": "SERVICE_REBATE" if is_customer_rebate else "MANUAL_ADJUSTMENT",
        "applicationMode": "CUSTOMER_ACCOUNT_CREDIT" if is_customer_rebate else "SELECTED_INVOICE",
        "status": status,
        "notes": payload.notes or "",
        "initialAppliedInvoiceId": invoice.get("id") if is_customer_rebate and invoice else "",
        "initialAppliedInvoiceNumber": invoice.get("invoiceNumber") if is_customer_rebate and invoice else "",
        "initialAppliedAmount": 0.0,
        "initialCreditApplicationIds": [],
        "postedByUsername": admin["username"],
        "postedByName": admin_display_name(admin),
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": None,
    }
    adjustments.append(adjustment)
    applied_rows = (
        apply_adjustment_credit_to_invoice(adjustment, invoice, admin["username"])
        if is_customer_rebate and invoice is not None
        else []
    )
    adjustment["initialAppliedAmount"] = money(
        sum(application.get("amount") for application in applied_rows)
    )
    adjustment["initialCreditApplicationIds"] = [
        application["id"]
        for application in applied_rows
    ]
    if not is_customer_rebate:
        invoice["updatedAt"] = timestamp
    add_audit(
        "billing_adjustment_posted",
        "BillingAdjustment",
        adjustment["id"],
        {
            "invoiceId": invoice.get("id") if invoice else "",
            "customerId": adjustment["customerId"],
            "source": adjustment["adjustmentSource"],
            "amount": amount,
            "appliedAmount": adjustment["initialAppliedAmount"],
            "availableCredit": adjustment_credit_remaining(adjustment),
            "reason": adjustment["reason"],
        },
        admin["username"],
    )
    persist_billing_state()
    return adjustment_summary(adjustment)


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
    applied_credit_rows = credit_applications_for_adjustment(current["id"])
    if applied_credit_rows:
        raise HTTPException(
            status_code=409,
            detail="This customer credit has already been applied to an invoice and cannot be voided",
        )
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
    if current.get("invoiceId"):
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
