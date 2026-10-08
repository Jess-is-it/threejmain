"""Owner-only staging reset for Customer Profiling import test data."""

from __future__ import annotations

import hashlib
import importlib
import json
import logging
import os
import secrets
import tempfile
import time
from pathlib import Path
from threading import RLock
from typing import Any

from fastapi import HTTPException

try:
    import psycopg
    from psycopg.rows import dict_row, tuple_row
except ImportError:  # pragma: no cover - local syntax checks without the API dependencies.
    psycopg = None
    dict_row = None
    tuple_row = None


logger = logging.getLogger(__name__)
CONFIRMATION_PHRASE = "RESET STAGING SUBSCRIBERS"
PREVIEW_SECONDS = 300
BACKUP_DIRECTORY = Path(os.getenv("STAGING_SUBSCRIBER_RESET_BACKUP_DIR", "/app/data/subscriber-reset-backups"))
_reset_lock = RLock()
_previews: dict[str, dict[str, Any]] = {}

# Only customer-owned records and import run history are selected. Service catalog
# plans and Billing promotions remain available for the next import.
_TARGET_QUERIES = {
    "customers": "SELECT id, updated_at FROM customer_profiles ORDER BY id",
    "importBatches": "SELECT id, updated_at FROM subscriber_migration_batches ORDER BY id",
    "importRows": "SELECT id, updated_at FROM subscriber_migration_rows ORDER BY id",
    "serviceAccountsAndOrders": "SELECT record_type || ':' || record_id, updated_at FROM service_records WHERE record_type IN ('account', 'order') ORDER BY 1",
    "migrationOnlyPlans": "SELECT record_type || ':' || record_id, updated_at FROM service_records WHERE record_type = 'catalog' AND data->>'migrationSource' = 'EXISTING_SUBSCRIBER_CSV' ORDER BY 1",
    "billingRecords": "SELECT record_type || ':' || record_id, updated_at FROM billing_records WHERE record_type <> 'promotion' ORDER BY 1",
    "billingEvents": "SELECT id, created_at FROM billing_posting_events WHERE target_type <> 'BillingPromotion' ORDER BY id",
    "collectorRecords": "SELECT record_type || ':' || record_id, updated_at FROM collector_records ORDER BY 1",
    "posCustomerRecords": "SELECT record_type || ':' || record_id, updated_at FROM pos_records WHERE customer_id <> '' ORDER BY 1",
    "inventoryAssignments": "SELECT id, updated_at FROM inventory_assignments WHERE customer_id <> '' ORDER BY id",
}

_LOCK_TABLES = (
    "billing_posting_events, billing_records, collector_records, customer_profiles, "
    "inventory_assignments, pos_records, service_records, "
    "subscriber_migration_batches, subscriber_migration_rows"
)

_DELETE_QUERIES = {
    "importRows": "DELETE FROM subscriber_migration_rows",
    "importBatches": "DELETE FROM subscriber_migration_batches",
    "inventoryAssignments": "DELETE FROM inventory_assignments WHERE customer_id <> ''",
    "posCustomerRecords": "DELETE FROM pos_records WHERE customer_id <> ''",
    "collectorRecords": "DELETE FROM collector_records",
    "billingEvents": "DELETE FROM billing_posting_events WHERE target_type <> 'BillingPromotion'",
    "billingRecords": "DELETE FROM billing_records WHERE record_type <> 'promotion'",
    "serviceAccountsAndOrders": "DELETE FROM service_records WHERE record_type IN ('account', 'order')",
    "migrationOnlyPlans": "DELETE FROM service_records WHERE record_type = 'catalog' AND data->>'migrationSource' = 'EXISTING_SUBSCRIBER_CSV'",
    "customers": "DELETE FROM customer_profiles",
}


def require_staging_owner(admin: dict[str, Any]) -> None:
    if os.getenv("APP_ENV", "").strip().lower() != "staging" or os.getenv("APP_BRANCH", "").strip().lower() != "staging":
        raise HTTPException(status_code=404, detail="Staging reset is unavailable")
    if str(admin.get("role") or "").strip().lower() != "owner":
        raise HTTPException(status_code=403, detail="Owner access is required for staging reset")
    if psycopg is None or dict_row is None or tuple_row is None or not os.getenv("DATABASE_URL", "").strip():
        raise HTTPException(status_code=503, detail="PostgreSQL is required for staging reset")


def _related_runtime() -> dict[str, list[dict[str, Any]]]:
    settings = importlib.import_module("system_settings.router")
    hotspot = importlib.import_module("account_access_management.router")
    ticketing = importlib.import_module("ticketing.router")
    care = importlib.import_module("customer_service_management.router")
    threads = [row for row in care.inbox_threads if row.get("customerId")]
    thread_ids = {row.get("id") for row in threads}
    a2p_logs = [
        row for row in settings.a2p_messaging_store().get("messageLogs", [])
        if isinstance(row, dict)
        and isinstance(row.get("request_context"), dict)
        and row["request_context"].get("customerId")
    ]
    sync_logs = [
        row for row in hotspot.load_hotspot_access_state().get("syncLogs", [])
        if isinstance(row, dict) and str(row.get("action") or "").startswith("SYNC_")
    ]
    return {
        "customerSmsLogs": a2p_logs,
        "hotspotSyncLogs": sync_logs,
        "hotspotContactOverrides": [
            {"id": key, "value": value}
            for key, value in hotspot.load_hotspot_access_state().get("contactOverrides", {}).items()
        ],
        "customerNetworkRecords": list(hotspot.customer_network_records.values()),
        "tickets": [row for row in ticketing.tickets if row.get("customerId")],
        "careRequests": [row for row in care.service_requests if row.get("customerId")],
        "careInteractions": [row for row in care.interactions if row.get("customerId")],
        "careFollowUps": [row for row in care.follow_ups if row.get("customerId")],
        "careInboxThreads": threads,
        "careInboxMessages": [row for row in care.inbox_messages if row.get("threadId") in thread_ids],
    }


def _snapshot(connection: Any) -> tuple[dict[str, int], str]:
    counts: dict[str, int] = {}
    versions: dict[str, list[tuple[str, str]]] = {}
    with connection.cursor(row_factory=tuple_row) as cursor:
        for label, query in _TARGET_QUERIES.items():
            cursor.execute(query)
            rows = [(str(row[0]), str(row[1])) for row in cursor.fetchall()]
            counts[label] = len(rows)
            versions[label] = rows
    for label, rows in _related_runtime().items():
        counts[label] = len(rows)
        versions[label] = sorted(
            (str(row.get("id")), str(row.get("updatedAt") or row.get("createdAt") or row.get("value") or ""))
            for row in rows
        )
    fingerprint = hashlib.sha256(json.dumps(versions, sort_keys=True).encode("utf-8")).hexdigest()
    return counts, fingerprint


def _blockers(counts: dict[str, int]) -> list[str]:
    blockers = []
    if counts["inventoryAssignments"]:
        blockers.append("Return or reconcile customer equipment assignments in Inventory first.")
    if counts["posCustomerRecords"]:
        blockers.append("Customer-linked POS sales need Finance and stock review before reset.")
    return blockers


def _prune_previews() -> None:
    now = time.time()
    for token, preview in list(_previews.items()):
        if preview["expiresAt"] <= now:
            _previews.pop(token, None)


def preview_staging_reset(admin: dict[str, Any]) -> dict[str, Any]:
    require_staging_owner(admin)
    with _reset_lock:
        _prune_previews()
        with psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row) as connection:
            counts, fingerprint = _snapshot(connection)
        token = secrets.token_urlsafe(32)
        expires_at = time.time() + PREVIEW_SECONDS
        _previews[token] = {"actorId": str(admin.get("id")), "fingerprint": fingerprint, "expiresAt": expires_at}
    return {
        "counts": counts,
        "blockers": _blockers(counts),
        "previewToken": token,
        "expiresAt": int(expires_at),
        "confirmationPhrase": CONFIRMATION_PHRASE,
    }


def _save_backup(admin: dict[str, Any], counts: dict[str, int]) -> str:
    settings = importlib.import_module("system_settings.router")
    hotspot = importlib.import_module("account_access_management.router")
    backup = settings.build_backup_payload("full", admin)
    database = backup.get("sections", {}).get("database", {}).get("data", {})
    if database.get("status") != "ok":
        raise HTTPException(status_code=503, detail="Full database backup could not be created; reset was cancelled")
    backup["stagingSubscriberReset"] = {
        "counts": counts,
        "hotspotAccessState": settings.json_safe(hotspot.load_hotspot_access_state()),
        "runtimeData": settings.json_safe(_related_runtime()),
        "confirmationPhrase": CONFIRMATION_PHRASE,
    }
    BACKUP_DIRECTORY.mkdir(parents=True, exist_ok=True, mode=0o700)
    BACKUP_DIRECTORY.chmod(0o700)
    filename = f"subscriber-reset-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}-{secrets.token_hex(4)}.json"
    destination = BACKUP_DIRECTORY / filename
    descriptor, temporary = tempfile.mkstemp(prefix=".subscriber-reset-", dir=BACKUP_DIRECTORY)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(backup, stream, ensure_ascii=True, separators=(",", ":"))
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, destination)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return filename


def _clear_runtime() -> list[str]:
    warnings: list[str] = []
    try:
        modules = {
            name: importlib.import_module(f"{name}.router")
            for name in ("customer_profiling", "service", "billing", "collector", "point_of_sale", "ticketing", "customer_service_management", "account_access_management", "system_settings")
        }
    except Exception:
        logger.exception("Staging subscriber reset could not load runtime modules")
        return ["Module views may need an API restart before they show the cleared data."]
    try:
        customer = modules["customer_profiling"]
        customer.all_customers()
        customer.subscriber_migration_store._batches.clear()
        customer.subscriber_migration_store._rows.clear()
        modules["service"].service_store.load_records(force=True)
        modules["billing"].billing_store.load_records(force=True)
        modules["collector"].collector_store.load_records(force=True)
        modules["point_of_sale"].pos_store.load_records(force=True)
        modules["ticketing"].tickets[:] = [row for row in modules["ticketing"].tickets if not row.get("customerId")]
        care = modules["customer_service_management"]
        for name in ("service_requests", "interactions", "follow_ups"):
            collection = getattr(care, name)
            collection[:] = [row for row in collection if not row.get("customerId")]
        removed_threads = {row.get("id") for row in care.inbox_threads if row.get("customerId")}
        care.inbox_threads[:] = [row for row in care.inbox_threads if row.get("id") not in removed_threads]
        care.inbox_messages[:] = [row for row in care.inbox_messages if row.get("threadId") not in removed_threads]
        modules["account_access_management"].customer_network_records.clear()
    except Exception:
        logger.exception("Staging subscriber reset could not refresh every runtime cache")
        warnings.append("Some in-memory module views may need an API restart before they show the cleared data.")
    try:
        settings = modules["system_settings"]
        store = settings.a2p_messaging_store()
        removed = [row for row in store["messageLogs"] if isinstance(row, dict) and isinstance(row.get("request_context"), dict) and row["request_context"].get("customerId")]
        removed_ids = {str(row.get("id")) for row in removed if row.get("id")}
        read_ids = removed_ids | {f"a2p-{row_id}" for row_id in removed_ids}
        store["messageLogs"] = [row for row in store["messageLogs"] if row not in removed]
        store["notificationReadIds"] = [value for value in store.get("notificationReadIds", []) if str(value) not in read_ids]
        store["notificationReadIdsByUser"] = {
            user: [value for value in values if str(value) not in read_ids]
            for user, values in store.get("notificationReadIdsByUser", {}).items()
        }
        settings.save_persisted_a2p_messaging_store()
        hotspot = modules["account_access_management"]
        hotspot_state = hotspot.load_hotspot_access_state()
        hotspot_state["contactOverrides"] = {}
        hotspot_state["syncLogs"] = [
            row for row in hotspot_state.get("syncLogs", [])
            if not (isinstance(row, dict) and str(row.get("action") or "").startswith("SYNC_"))
        ]
        hotspot.save_hotspot_access_state()
    except Exception:
        logger.exception("Staging subscriber reset could not clear related message history")
        warnings.append("Subscriber SMS or hotspot sync history could not be fully cleared; retry after reviewing the backup.")
    return warnings


def execute_staging_reset(admin: dict[str, Any], preview_token: str, confirmation: str) -> dict[str, Any]:
    require_staging_owner(admin)
    if confirmation != CONFIRMATION_PHRASE:
        raise HTTPException(status_code=400, detail="Type the exact confirmation phrase")
    with _reset_lock:
        _prune_previews()
        preview = _previews.get(preview_token)
        if not preview or preview["actorId"] != str(admin.get("id")):
            raise HTTPException(status_code=409, detail="Reset preview expired; refresh it before continuing")
        backup_filename = ""
        with psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SET LOCAL lock_timeout = '10s'")
                cursor.execute("SET LOCAL statement_timeout = '90s'")
                cursor.execute(f"LOCK TABLE {_LOCK_TABLES} IN SHARE ROW EXCLUSIVE MODE")
                counts, fingerprint = _snapshot(connection)
                if fingerprint != preview["fingerprint"]:
                    raise HTTPException(status_code=409, detail="Subscriber data changed since preview; refresh and review the counts again")
                blockers = _blockers(counts)
                if blockers:
                    raise HTTPException(status_code=409, detail=" ".join(blockers))
                backup_filename = _save_backup(admin, counts)
                deleted: dict[str, int] = {}
                for label, statement in _DELETE_QUERIES.items():
                    cursor.execute(statement)
                    deleted[label] = cursor.rowcount
        _previews.pop(preview_token, None)
        warnings = _clear_runtime()
    return {"status": "completed", "deleted": deleted, "backupFile": backup_filename, "warnings": warnings}
