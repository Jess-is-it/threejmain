from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from contextlib import contextmanager
from datetime import datetime, timezone
from threading import RLock
from typing import Any, Iterator
from uuid import uuid4

from fastapi import HTTPException

try:
    import psycopg
    from psycopg.rows import dict_row
    from psycopg.types.json import Json
except Exception:  # pragma: no cover - syntax/unit checks can run without the optional driver.
    psycopg = None
    dict_row = None
    Json = None


logger = logging.getLogger(__name__)

INVENTORY_STORAGE_MODE = os.getenv("INVENTORY_STORAGE") or ("postgres" if os.getenv("DATABASE_URL") else "memory")
LOCATION_TYPES = ["WAREHOUSE", "STOCKROOM", "BIN", "VEHICLE", "TRANSIT", "CUSTOMER", "DAMAGED", "VIRTUAL"]


def clean_text(value: Any) -> str:
    return str(value or "").strip()


def upper_text(value: Any) -> str:
    return clean_text(value).upper()


def quantity(value: Any) -> float:
    return round(float(value or 0), 4)


def timestamp(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def canonical_fingerprint(payload: dict[str, Any]) -> str:
    serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


class InventoryPostgresStore:
    """Relational Inventory storage and append-only stock posting service."""

    def __init__(self) -> None:
        self.database_url = os.getenv("DATABASE_URL", "").strip()
        self.storage_mode = INVENTORY_STORAGE_MODE.strip().lower()
        self._schema_ready = False
        self._process_lock = RLock()

    @property
    def postgres_enabled(self) -> bool:
        return self.storage_mode == "postgres"

    def _connect(self, autocommit: bool = True):
        if not self.postgres_enabled:
            return None
        if psycopg is None or dict_row is None:
            raise HTTPException(status_code=503, detail="Inventory database driver is not installed")
        if not self.database_url:
            raise HTTPException(status_code=503, detail="Inventory database URL is not configured")
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
                cursor.execute(
                    """
                    SELECT
                        to_regclass('public.inventory_items') AS items_table,
                        to_regclass('public.inventory_stock_movements') AS movement_table,
                        to_regclass('public.inventory_stock_balances') AS balance_table,
                        to_regclass('public.inventory_locations') AS location_table
                    """
                )
                row = cursor.fetchone() or {}
                if not all(row.get(key) for key in ["items_table", "movement_table", "balance_table", "location_table"]):
                    raise HTTPException(status_code=503, detail="Inventory database migration has not run")
            self._schema_ready = True
            return True
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Inventory database schema check failed")
            raise HTTPException(status_code=503, detail=f"Inventory database is unavailable: {exc}") from exc
        finally:
            if owns_connection and conn is not None:
                conn.close()

    @contextmanager
    def transaction(self, connection=None) -> Iterator[Any]:
        """Use a serial Inventory posting transaction, optionally joining a caller connection."""
        if not self.postgres_enabled:
            yield None
            return
        self.ensure_schema(connection)
        owns_connection = connection is None
        conn = connection or self._connect(autocommit=False)
        lock = self._process_lock if owns_connection else _NullLock()
        with lock:
            try:
                with conn.cursor() as cursor:
                    cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", ("threejmain.inventory.stock-ledger",))
                yield conn
                if owns_connection:
                    conn.commit()
            except Exception as exc:
                if owns_connection:
                    conn.rollback()
                if psycopg is not None and isinstance(exc, psycopg.errors.UniqueViolation):
                    raise HTTPException(status_code=409, detail="Duplicate Inventory posting was prevented") from exc
                if psycopg is not None and isinstance(exc, psycopg.errors.CheckViolation):
                    raise HTTPException(status_code=409, detail="Inventory balance or ledger constraint rejected the posting") from exc
                raise
            finally:
                if owns_connection:
                    conn.close()

    @contextmanager
    def read_connection(self, connection=None) -> Iterator[Any]:
        self.ensure_schema(connection)
        owns_connection = connection is None
        conn = connection or self._connect()
        try:
            yield conn
        finally:
            if owns_connection:
                conn.close()

    def status(self) -> dict[str, Any]:
        if not self.postgres_enabled:
            return {"mode": "memory", "ready": False, "reason": "INVENTORY_STORAGE is not postgres"}
        with self.read_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                        (SELECT count(*) FROM inventory_items WHERE deleted_at IS NULL) AS items,
                        (SELECT count(*) FROM inventory_locations WHERE active) AS locations,
                        (SELECT count(*) FROM inventory_stock_movements) AS movements,
                        (SELECT count(*) FROM inventory_stock_balances WHERE quantity > 0) AS positive_balances
                    """
                )
                row = cursor.fetchone() or {}
        return {
            "mode": "postgres",
            "ready": True,
            "tables": [
                "inventory_items",
                "inventory_locations",
                "inventory_stock_balances",
                "inventory_stock_movements",
                "inventory_assignments",
            ],
            "recordCounts": {key: int(row.get(key) or 0) for key in ["items", "locations", "movements", "positive_balances"]},
            "movementLedger": "append-only",
        }

    def _location_payload(self, row: dict[str, Any]) -> dict[str, Any]:
        data = dict(row.get("data") or {})
        return {
            **data,
            "id": row["id"],
            "code": row["code"],
            "name": row["name"],
            "type": row["location_type"],
            "parentLocationId": row.get("parent_location_id") or "",
            "active": bool(row.get("active")),
            "createdAt": timestamp(row.get("created_at")),
            "updatedAt": timestamp(row.get("updated_at")),
            "archivedAt": timestamp(row.get("archived_at")),
        }

    def list_locations(self, include_inactive: bool = False, connection=None) -> list[dict[str, Any]]:
        with self.read_connection(connection) as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                        l.*,
                        count(DISTINCT b.item_id) FILTER (WHERE b.quantity > 0) AS item_count,
                        COALESCE(sum(b.quantity), 0) AS total_quantity
                    FROM inventory_locations l
                    LEFT JOIN inventory_stock_balances b ON b.location_id = l.id
                    WHERE (%s OR l.active)
                    GROUP BY l.id
                    ORDER BY l.active DESC, l.name, l.code
                    """,
                    (include_inactive,),
                )
                rows = cursor.fetchall()
        return [
            {
                **self._location_payload(row),
                "itemCount": int(row.get("item_count") or 0),
                "totalQuantity": quantity(row.get("total_quantity")),
            }
            for row in rows
        ]

    def get_location(self, location_id: str, connection=None) -> dict[str, Any]:
        with self.read_connection(connection) as conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT * FROM inventory_locations WHERE id = %s", (location_id,))
                row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Inventory location not found")
        return self._location_payload(row)

    def _resolve_location(self, conn, value: Any, *, create_missing: bool = False) -> dict[str, Any]:
        needle = clean_text(value) or "inventory-location-main"
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT * FROM inventory_locations
                WHERE id = %s OR lower(code) = lower(%s) OR lower(name) = lower(%s)
                ORDER BY active DESC
                LIMIT 1
                """,
                (needle, needle, needle),
            )
            row = cursor.fetchone()
            if row:
                return row
            if not create_missing:
                raise HTTPException(status_code=400, detail=f"Inventory location '{needle}' was not found")
            base_code = re.sub(r"[^A-Z0-9]+", "-", upper_text(needle)).strip("-")[:24] or "LOCATION"
            location_id = str(uuid4())
            code = base_code
            suffix = 1
            while True:
                cursor.execute("SELECT 1 FROM inventory_locations WHERE lower(code) = lower(%s)", (code,))
                if not cursor.fetchone():
                    break
                suffix += 1
                code = f"{base_code[:20]}-{suffix}"
            now = datetime.now(timezone.utc)
            cursor.execute(
                """
                INSERT INTO inventory_locations (id, code, name, location_type, active, data, created_at, updated_at)
                VALUES (%s, %s, %s, 'STOCKROOM', true, '{}'::jsonb, %s, %s)
                RETURNING *
                """,
                (location_id, code, needle, now, now),
            )
            return cursor.fetchone()

    def create_location(self, record: dict[str, Any]) -> dict[str, Any]:
        location_type = upper_text(record.get("type") or "STOCKROOM")
        if location_type not in LOCATION_TYPES:
            raise HTTPException(status_code=400, detail="Invalid inventory location type")
        name = clean_text(record.get("name"))
        code = upper_text(record.get("code"))
        if not name or not code:
            raise HTTPException(status_code=400, detail="Location code and name are required")
        with self.transaction() as conn:
            parent_id = clean_text(record.get("parentLocationId")) or None
            if parent_id:
                self._resolve_location(conn, parent_id)
            now = datetime.now(timezone.utc)
            location_id = str(uuid4())
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO inventory_locations (id, code, name, location_type, parent_location_id, active, data, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (location_id, code, name, location_type, parent_id, bool(record.get("active", True)), Json(record), now, now),
                )
        return self.get_location(location_id)

    def update_location(self, location_id: str, record: dict[str, Any]) -> dict[str, Any]:
        current = self.get_location(location_id)
        merged = {**current, **record}
        location_type = upper_text(merged.get("type"))
        if location_type not in LOCATION_TYPES:
            raise HTTPException(status_code=400, detail="Invalid inventory location type")
        code = upper_text(merged.get("code"))
        name = clean_text(merged.get("name"))
        if not code or not name:
            raise HTTPException(status_code=400, detail="Location code and name are required")
        parent_id = clean_text(merged.get("parentLocationId")) or None
        if parent_id == location_id:
            raise HTTPException(status_code=400, detail="A location cannot be its own parent")
        with self.transaction() as conn:
            if parent_id:
                self._resolve_location(conn, parent_id)
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE inventory_locations
                    SET code = %s, name = %s, location_type = %s, parent_location_id = %s,
                        active = %s, data = %s, updated_at = now(),
                        archived_at = CASE WHEN %s THEN NULL ELSE COALESCE(archived_at, now()) END
                    WHERE id = %s
                    """,
                    (code, name, location_type, parent_id, bool(merged.get("active", True)), Json(merged), bool(merged.get("active", True)), location_id),
                )
        return self.get_location(location_id)

    def archive_location(self, location_id: str) -> dict[str, str]:
        if location_id in {"inventory-location-main", "inventory-location-transit", "inventory-location-damaged"}:
            raise HTTPException(status_code=409, detail="System Inventory locations cannot be archived")
        with self.transaction() as conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT COALESCE(sum(quantity), 0) AS quantity FROM inventory_stock_balances WHERE location_id = %s", (location_id,))
                if quantity((cursor.fetchone() or {}).get("quantity")) > 0:
                    raise HTTPException(status_code=409, detail="Move all stock out before archiving this location")
                cursor.execute("UPDATE inventory_locations SET active = false, archived_at = now(), updated_at = now() WHERE id = %s", (location_id,))
                if cursor.rowcount == 0:
                    raise HTTPException(status_code=404, detail="Inventory location not found")
        return {"status": "ok"}

    def _item_payload(self, row: dict[str, Any]) -> dict[str, Any]:
        data = dict(row.get("data") or {})
        on_hand = quantity(row.get("quantity_on_hand"))
        assigned = quantity(row.get("assigned_quantity"))
        stock_tracked = row["tracking_type"] != "NON_STOCK"
        available = max(0, quantity(on_hand - assigned)) if stock_tracked else 0
        unit_cost = quantity(data.get("unitCost"))
        return {
            **data,
            "id": row["id"],
            "sku": row["sku"],
            "name": row["name"],
            "category": row["category"],
            "trackingType": row["tracking_type"],
            "status": row["status"],
            "locationId": row.get("default_location_id") or "",
            "location": row.get("location_name") or data.get("location") or "Main stockroom",
            "quantityOnHand": on_hand if stock_tracked else 0,
            "assignedQuantity": assigned,
            "availableQuantity": available,
            "stockTracked": stock_tracked,
            "stockValue": quantity(on_hand * unit_cost) if stock_tracked else 0,
            "lowStock": stock_tracked and row["status"] == "ACTIVE" and on_hand <= quantity(data.get("reorderPoint")),
            "createdAt": timestamp(row.get("created_at")),
            "updatedAt": timestamp(row.get("updated_at")),
            "deletedAt": timestamp(row.get("deleted_at")),
        }

    def _select_items(self, conn, where: str = "", params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        with conn.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT
                    i.*,
                    l.name AS location_name,
                    COALESCE((SELECT sum(b.quantity) FROM inventory_stock_balances b WHERE b.item_id = i.id), 0) AS quantity_on_hand,
                    COALESCE((
                        SELECT sum(a.quantity) FROM inventory_assignments a
                        WHERE a.item_id = i.id AND a.status = 'ASSIGNED' AND a.deleted_at IS NULL
                    ), 0) AS assigned_quantity
                FROM inventory_items i
                LEFT JOIN inventory_locations l ON l.id = i.default_location_id
                {where}
                ORDER BY i.updated_at DESC, i.name
                """,
                params,
            )
            return cursor.fetchall()

    def list_items(self, include_deleted: bool = False, connection=None) -> list[dict[str, Any]]:
        with self.read_connection(connection) as conn:
            where = "" if include_deleted else "WHERE i.deleted_at IS NULL"
            rows = self._select_items(conn, where)
        return [self._item_payload(row) for row in rows]

    def get_item(self, item_id: str, connection=None, *, for_update: bool = False) -> dict[str, Any]:
        with self.read_connection(connection) as conn:
            if for_update:
                with conn.cursor() as cursor:
                    cursor.execute("SELECT id FROM inventory_items WHERE id = %s AND deleted_at IS NULL FOR UPDATE", (item_id,))
                    if not cursor.fetchone():
                        raise HTTPException(status_code=404, detail="Inventory item not found")
            rows = self._select_items(conn, "WHERE i.id = %s AND i.deleted_at IS NULL", (item_id,))
        if not rows:
            raise HTTPException(status_code=404, detail="Inventory item not found")
        return self._item_payload(rows[0])

    def _upsert_item(self, conn, record: dict[str, Any]) -> None:
        payload = dict(record)
        for key in ["quantityOnHand", "assignedQuantity", "availableQuantity", "stockTracked", "stockValue", "lowStock", "locationId"]:
            payload.pop(key, None)
        with conn.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO inventory_items (
                    id, sku, name, category, tracking_type, status, default_location_id,
                    data, created_at, updated_at, deleted_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    sku = EXCLUDED.sku,
                    name = EXCLUDED.name,
                    category = EXCLUDED.category,
                    tracking_type = EXCLUDED.tracking_type,
                    status = EXCLUDED.status,
                    default_location_id = EXCLUDED.default_location_id,
                    data = EXCLUDED.data,
                    updated_at = EXCLUDED.updated_at,
                    deleted_at = EXCLUDED.deleted_at
                """,
                (
                    record["id"], record["sku"], record["name"], record["category"], record["trackingType"], record["status"],
                    record.get("locationId") or None, Json(payload), record["createdAt"], record["updatedAt"], record.get("deletedAt"),
                ),
            )

    def create_item(self, record: dict[str, Any], actor: str) -> dict[str, Any]:
        opening_quantity = quantity(record.get("quantityOnHand"))
        with self.transaction() as conn:
            location = self._resolve_location(conn, record.get("locationId") or record.get("location"), create_missing=True)
            now = datetime.now(timezone.utc).isoformat()
            item_id = clean_text(record.get("id")) or str(uuid4())
            stored = {
                **record,
                "id": item_id,
                "locationId": location["id"],
                "location": location["name"],
                "quantityOnHand": 0,
                "createdAt": record.get("createdAt") or now,
                "updatedAt": now,
                "deletedAt": None,
            }
            self._upsert_item(conn, stored)
            if stored["trackingType"] != "NON_STOCK" and opening_quantity > 0:
                self._post_movement(
                    conn,
                    {
                        "itemId": item_id,
                        "type": "ADJUST",
                        "quantity": opening_quantity,
                        "fromLocation": "",
                        "toLocation": location["id"],
                        "referenceType": "OPENING_BALANCE",
                        "referenceId": item_id,
                        "serialNumber": "",
                        "notes": "Opening balance captured when the item was created.",
                    },
                    actor=actor,
                    idempotency_key=f"inventory-item-opening:{item_id}",
                )
        return self.get_item(item_id)

    def update_item(self, item_id: str, record: dict[str, Any], actor: str, quantity_was_supplied: bool) -> dict[str, Any]:
        with self.transaction() as conn:
            current = self.get_item(item_id, conn, for_update=True)
            location = self._resolve_location(conn, record.get("locationId") or record.get("location") or current.get("locationId"), create_missing=True)
            desired_quantity = quantity(record.get("quantityOnHand"))
            stored = {
                **current,
                **record,
                "id": item_id,
                "locationId": location["id"],
                "location": location["name"],
                "updatedAt": datetime.now(timezone.utc).isoformat(),
            }
            self._upsert_item(conn, stored)
            if quantity_was_supplied and stored["trackingType"] != "NON_STOCK":
                delta = quantity(desired_quantity - quantity(current.get("quantityOnHand")))
                if delta:
                    self._post_movement(
                        conn,
                        {
                            "itemId": item_id,
                            "type": "ADJUST",
                            "quantity": abs(delta),
                            "fromLocation": location["id"] if delta < 0 else "",
                            "toLocation": location["id"] if delta > 0 else "",
                            "referenceType": "ITEM_BALANCE_CORRECTION",
                            "referenceId": item_id,
                            "serialNumber": "",
                            "notes": "Balance correction captured from the item edit form.",
                        },
                        actor=actor,
                        idempotency_key=f"inventory-item-adjust:{item_id}:{uuid4()}",
                    )
        return self.get_item(item_id)

    def archive_item(self, item_id: str) -> dict[str, str]:
        with self.transaction() as conn:
            current = self.get_item(item_id, conn, for_update=True)
            with conn.cursor() as cursor:
                cursor.execute(
                    "UPDATE inventory_items SET status = 'ARCHIVED', deleted_at = now(), updated_at = now() WHERE id = %s",
                    (item_id,),
                )
            if quantity(current.get("quantityOnHand")) > 0:
                raise HTTPException(status_code=409, detail="Inventory item with stock on hand cannot be archived")
        return {"status": "ok"}

    def list_balances(self, item_id: str = "", location_id: str = "", connection=None) -> list[dict[str, Any]]:
        with self.read_connection(connection) as conn:
            clauses = ["i.deleted_at IS NULL"]
            params: list[Any] = []
            if item_id:
                clauses.append("b.item_id = %s")
                params.append(item_id)
            if location_id:
                clauses.append("b.location_id = %s")
                params.append(location_id)
            with conn.cursor() as cursor:
                cursor.execute(
                    f"""
                    SELECT b.*, i.sku, i.name AS item_name, l.code AS location_code, l.name AS location_name, l.location_type
                    FROM inventory_stock_balances b
                    JOIN inventory_items i ON i.id = b.item_id
                    JOIN inventory_locations l ON l.id = b.location_id
                    WHERE {' AND '.join(clauses)}
                    ORDER BY l.name, i.name
                    """,
                    tuple(params),
                )
                rows = cursor.fetchall()
        return [
            {
                "itemId": row["item_id"],
                "item": {"id": row["item_id"], "sku": row["sku"], "name": row["item_name"]},
                "locationId": row["location_id"],
                "location": {"id": row["location_id"], "code": row["location_code"], "name": row["location_name"], "type": row["location_type"]},
                "quantity": quantity(row["quantity"]),
                "version": int(row["version"]),
                "updatedAt": timestamp(row["updated_at"]),
            }
            for row in rows
        ]

    def _movement_payload(self, row: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": row["id"],
            "itemId": row["item_id"],
            "item": {"id": row["item_id"], "sku": row["sku"], "name": row["item_name"], "unit": row["unit"]},
            "type": row["movement_type"],
            "quantity": quantity(row["quantity"]),
            "serialNumber": row.get("serial_number") or "",
            "fromLocationId": row.get("from_location_id") or "",
            "fromLocation": row.get("from_location_name") or "",
            "toLocationId": row.get("to_location_id") or "",
            "toLocation": row.get("to_location_name") or "",
            "referenceType": row.get("reference_type") or "MANUAL",
            "referenceId": row.get("reference_id") or "",
            "idempotencyKey": row.get("idempotency_key") or "",
            "reversalOfId": row.get("reversal_of_id") or "",
            "actor": row.get("actor") or "",
            "notes": row.get("notes") or "",
            "createdAt": timestamp(row.get("created_at")),
            "updatedAt": timestamp(row.get("created_at")),
            "deletedAt": None,
            "immutable": True,
        }

    def _movement_select(self, conn, where: str = "", params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        with conn.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT
                    m.*,
                    i.sku,
                    i.name AS item_name,
                    COALESCE(i.data->>'unit', 'pcs') AS unit,
                    source.name AS from_location_name,
                    destination.name AS to_location_name
                FROM inventory_stock_movements m
                JOIN inventory_items i ON i.id = m.item_id
                LEFT JOIN inventory_locations source ON source.id = m.from_location_id
                LEFT JOIN inventory_locations destination ON destination.id = m.to_location_id
                {where}
                ORDER BY m.created_at DESC, m.id DESC
                """,
                params,
            )
            return cursor.fetchall()

    def list_movements(self, connection=None) -> list[dict[str, Any]]:
        with self.read_connection(connection) as conn:
            rows = self._movement_select(conn)
        return [self._movement_payload(row) for row in rows]

    def get_movement(self, movement_id: str, connection=None) -> dict[str, Any]:
        with self.read_connection(connection) as conn:
            rows = self._movement_select(conn, "WHERE m.id = %s", (movement_id,))
        if not rows:
            raise HTTPException(status_code=404, detail="Inventory movement not found")
        return self._movement_payload(rows[0])

    def _update_balance(self, conn, item_id: str, location_id: str, delta: float) -> None:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO inventory_stock_balances (item_id, location_id, quantity, version, updated_at)
                VALUES (%s, %s, 0, 0, now())
                ON CONFLICT (item_id, location_id) DO NOTHING
                """,
                (item_id, location_id),
            )
            cursor.execute(
                "SELECT quantity FROM inventory_stock_balances WHERE item_id = %s AND location_id = %s FOR UPDATE",
                (item_id, location_id),
            )
            current = quantity((cursor.fetchone() or {}).get("quantity"))
            next_quantity = quantity(current + delta)
            if next_quantity < 0:
                location = self._resolve_location(conn, location_id)
                raise HTTPException(status_code=409, detail=f"Movement would make stock negative at {location['name']}")
            cursor.execute(
                """
                UPDATE inventory_stock_balances
                SET quantity = %s, version = version + 1, updated_at = now()
                WHERE item_id = %s AND location_id = %s
                """,
                (next_quantity, item_id, location_id),
            )

    def _post_movement(
        self,
        conn,
        record: dict[str, Any],
        *,
        actor: str,
        idempotency_key: str,
        reversal_of_id: str | None = None,
    ) -> dict[str, Any]:
        posting_key = clean_text(idempotency_key)
        if not posting_key:
            raise HTTPException(status_code=400, detail="Idempotency-Key header is required")
        if len(posting_key) > 160:
            raise HTTPException(status_code=400, detail="Idempotency-Key cannot exceed 160 characters")
        item = self.get_item(clean_text(record.get("itemId")), conn, for_update=True)
        if item["trackingType"] == "NON_STOCK":
            raise HTTPException(status_code=400, detail="Non-stock items do not use inventory movements")
        movement_type = upper_text(record.get("type") or "RECEIVE")
        movement_quantity = quantity(record.get("quantity"))
        if movement_type not in ["RECEIVE", "ISSUE", "ADJUST", "TRANSFER", "RETURN"]:
            raise HTTPException(status_code=400, detail="Invalid movement type")
        if movement_quantity <= 0:
            raise HTTPException(status_code=400, detail="Movement quantity must be greater than zero")

        from_value = clean_text(record.get("fromLocationId") or record.get("fromLocation"))
        to_value = clean_text(record.get("toLocationId") or record.get("toLocation"))
        default_location = item.get("locationId") or "inventory-location-main"
        if movement_type in ["RECEIVE", "RETURN"]:
            from_value = ""
            to_value = to_value or default_location
        elif movement_type == "ISSUE":
            from_value = from_value or default_location
            to_value = ""
        elif movement_type == "TRANSFER":
            from_value = from_value or default_location
            if not to_value:
                raise HTTPException(status_code=400, detail="Transfer destination is required")
        elif movement_type == "ADJUST":
            if bool(from_value) == bool(to_value):
                if not from_value and not to_value:
                    to_value = default_location
                else:
                    raise HTTPException(status_code=400, detail="Adjustment must specify exactly one source or destination")

        source = self._resolve_location(conn, from_value, create_missing=True) if from_value else None
        destination = self._resolve_location(conn, to_value, create_missing=True) if to_value else None
        if source and destination and source["id"] == destination["id"]:
            raise HTTPException(status_code=400, detail="Transfer source and destination must be different")

        serial_number = clean_text(record.get("serialNumber"))
        registered_serials = item.get("serialNumbers") or []
        if serial_number and registered_serials and serial_number not in registered_serials:
            raise HTTPException(status_code=400, detail="serialNumber is not registered on this item")
        request = {
            "itemId": item["id"],
            "type": movement_type,
            "quantity": movement_quantity,
            "serialNumber": serial_number,
            "fromLocationId": source["id"] if source else "",
            "toLocationId": destination["id"] if destination else "",
            "referenceType": upper_text(record.get("referenceType") or "MANUAL"),
            "referenceId": clean_text(record.get("referenceId")),
            "reversalOfId": reversal_of_id or "",
        }
        fingerprint = canonical_fingerprint(request)
        with conn.cursor() as cursor:
            cursor.execute("SELECT id, request_fingerprint FROM inventory_stock_movements WHERE idempotency_key = %s", (posting_key,))
            existing = cursor.fetchone()
        if existing:
            if existing["request_fingerprint"] != fingerprint:
                raise HTTPException(status_code=409, detail="Idempotency-Key was already used with a different Inventory movement")
            replay = self.get_movement(existing["id"], conn)
            replay["idempotentReplay"] = True
            return replay

        if source:
            self._update_balance(conn, item["id"], source["id"], -movement_quantity)
        if destination:
            self._update_balance(conn, item["id"], destination["id"], movement_quantity)
        movement_id = str(uuid4())
        with conn.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO inventory_stock_movements (
                    id, item_id, movement_type, quantity, serial_number,
                    from_location_id, to_location_id, reference_type, reference_id,
                    idempotency_key, request_fingerprint, reversal_of_id, actor, notes, created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
                """,
                (
                    movement_id, item["id"], movement_type, movement_quantity, serial_number,
                    source["id"] if source else None, destination["id"] if destination else None,
                    request["referenceType"], request["referenceId"], posting_key, fingerprint,
                    reversal_of_id, clean_text(actor) or "system", clean_text(record.get("notes")),
                ),
            )
        return self.get_movement(movement_id, conn)

    def post_movement(
        self,
        record: dict[str, Any],
        *,
        actor: str,
        idempotency_key: str,
        connection=None,
        reversal_of_id: str | None = None,
    ) -> dict[str, Any]:
        with self.transaction(connection) as conn:
            return self._post_movement(
                conn,
                record,
                actor=actor,
                idempotency_key=idempotency_key,
                reversal_of_id=reversal_of_id,
            )

    def reverse_movement(self, movement_id: str, *, actor: str, idempotency_key: str, notes: str = "") -> dict[str, Any]:
        with self.transaction() as conn:
            original = self.get_movement(movement_id, conn)
            if original.get("reversalOfId"):
                raise HTTPException(status_code=409, detail="A reversal movement cannot itself be reversed")
            if original["type"] in ["RECEIVE", "RETURN"]:
                movement_type = "ISSUE"
                from_location = original["toLocationId"]
                to_location = ""
            elif original["type"] == "ISSUE":
                movement_type = "RETURN"
                from_location = ""
                to_location = original["fromLocationId"]
            elif original["type"] == "TRANSFER":
                movement_type = "TRANSFER"
                from_location = original["toLocationId"]
                to_location = original["fromLocationId"]
            else:
                movement_type = "ADJUST"
                from_location = original["toLocationId"]
                to_location = original["fromLocationId"]
            return self._post_movement(
                conn,
                {
                    "itemId": original["itemId"],
                    "type": movement_type,
                    "quantity": original["quantity"],
                    "serialNumber": original.get("serialNumber"),
                    "fromLocationId": from_location,
                    "toLocationId": to_location,
                    "referenceType": "REVERSAL",
                    "referenceId": original["id"],
                    "notes": clean_text(notes) or f"Reversal of Inventory movement {original['id']}",
                },
                actor=actor,
                idempotency_key=idempotency_key,
                reversal_of_id=original["id"],
            )

    def serial_unavailable(self, item_id: str, serial_number: str, connection=None) -> bool:
        with self.read_connection(connection) as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT EXISTS (
                        SELECT 1 FROM inventory_assignments
                        WHERE item_id = %s AND serial_number = %s AND status = 'ASSIGNED' AND deleted_at IS NULL
                    ) AS assigned
                    """,
                    (item_id, serial_number),
                )
                if bool((cursor.fetchone() or {}).get("assigned")):
                    return True
                cursor.execute(
                    """
                    SELECT COALESCE(sum(
                        CASE
                            WHEN movement_type IN ('RECEIVE', 'RETURN') THEN quantity
                            WHEN movement_type = 'ISSUE' THEN -quantity
                            WHEN movement_type = 'ADJUST' AND to_location_id IS NOT NULL THEN quantity
                            WHEN movement_type = 'ADJUST' AND from_location_id IS NOT NULL THEN -quantity
                            ELSE 0
                        END
                    ), 0) AS serial_balance
                    FROM inventory_stock_movements
                    WHERE item_id = %s AND serial_number = %s
                    """,
                    (item_id, serial_number),
                )
                return quantity((cursor.fetchone() or {}).get("serial_balance")) < 0

    def _assignment_payload(self, row: dict[str, Any]) -> dict[str, Any]:
        data = dict(row.get("data") or {})
        return {
            **data,
            "id": row["id"],
            "itemId": row["item_id"],
            "item": {
                "id": row["item_id"],
                "sku": row["sku"],
                "name": row["item_name"],
                "unit": row["unit"],
                "trackingType": row["tracking_type"],
            },
            "serialNumber": row["serial_number"],
            "quantity": quantity(row["quantity"]),
            "assigneeType": row["assignee_type"],
            "status": row["status"],
            "customerId": row["customer_id"],
            "serviceId": row["service_id"],
            "ticketId": row["ticket_id"],
            "createdAt": timestamp(row["created_at"]),
            "updatedAt": timestamp(row["updated_at"]),
            "deletedAt": timestamp(row["deleted_at"]),
        }

    def list_assignments(self, connection=None) -> list[dict[str, Any]]:
        with self.read_connection(connection) as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT a.*, i.sku, i.name AS item_name, i.tracking_type, COALESCE(i.data->>'unit', 'pcs') AS unit
                    FROM inventory_assignments a
                    JOIN inventory_items i ON i.id = a.item_id
                    WHERE a.deleted_at IS NULL
                    ORDER BY a.created_at DESC
                    """
                )
                rows = cursor.fetchall()
        return [self._assignment_payload(row) for row in rows]

    def get_assignment(self, assignment_id: str, connection=None) -> dict[str, Any]:
        rows = [row for row in self.list_assignments(connection) if row["id"] == assignment_id]
        if not rows:
            raise HTTPException(status_code=404, detail="Asset assignment not found")
        return rows[0]

    def save_assignment(self, record: dict[str, Any]) -> dict[str, Any]:
        with self.transaction() as conn:
            item = self.get_item(record["itemId"], conn, for_update=True)
            if record.get("status") == "ASSIGNED":
                current_id = clean_text(record.get("id"))
                current_quantity = 0.0
                if current_id:
                    try:
                        current = self.get_assignment(current_id, conn)
                        if current["itemId"] == item["id"] and current["status"] == "ASSIGNED":
                            current_quantity = quantity(current["quantity"])
                    except HTTPException:
                        current_quantity = 0.0
                if quantity(record.get("quantity")) > quantity(item["availableQuantity"] + current_quantity):
                    raise HTTPException(status_code=409, detail="Not enough available stock for assignment")
            now = datetime.now(timezone.utc).isoformat()
            assignment_id = clean_text(record.get("id")) or str(uuid4())
            created_at = record.get("createdAt") or now
            stored = {**record, "id": assignment_id, "createdAt": created_at, "updatedAt": now, "deletedAt": record.get("deletedAt")}
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO inventory_assignments (
                        id, item_id, serial_number, quantity, assignee_type, status,
                        customer_id, service_id, ticket_id, data, created_at, updated_at, deleted_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        item_id = EXCLUDED.item_id,
                        serial_number = EXCLUDED.serial_number,
                        quantity = EXCLUDED.quantity,
                        assignee_type = EXCLUDED.assignee_type,
                        status = EXCLUDED.status,
                        customer_id = EXCLUDED.customer_id,
                        service_id = EXCLUDED.service_id,
                        ticket_id = EXCLUDED.ticket_id,
                        data = EXCLUDED.data,
                        updated_at = EXCLUDED.updated_at,
                        deleted_at = EXCLUDED.deleted_at
                    """,
                    (
                        assignment_id, stored["itemId"], clean_text(stored.get("serialNumber")), quantity(stored.get("quantity")),
                        upper_text(stored.get("assigneeType")), upper_text(stored.get("status")), clean_text(stored.get("customerId")),
                        clean_text(stored.get("serviceId")), clean_text(stored.get("ticketId")), Json(stored), created_at, now, stored.get("deletedAt"),
                    ),
                )
        return self.get_assignment(assignment_id)

    def return_assignment(self, assignment_id: str) -> dict[str, str]:
        with self.transaction() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE inventory_assignments
                    SET status = 'RETURNED',
                        data = jsonb_set(jsonb_set(data, '{status}', '"RETURNED"'::jsonb), '{returnedDate}', to_jsonb(current_date::text)),
                        updated_at = now(), deleted_at = now()
                    WHERE id = %s AND deleted_at IS NULL
                    """,
                    (assignment_id,),
                )
                if cursor.rowcount == 0:
                    raise HTTPException(status_code=404, detail="Asset assignment not found")
        return {"status": "ok"}

    def seed_items(self, rows: list[dict[str, Any]]) -> None:
        if not self.postgres_enabled:
            return
        with self.read_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT count(*) AS total FROM inventory_items WHERE deleted_at IS NULL")
                if int((cursor.fetchone() or {}).get("total") or 0) > 0:
                    return
        for row in rows:
            try:
                self.create_item(row, actor="system-seed")
            except HTTPException as exc:
                if exc.status_code != 409:
                    raise


class _NullLock:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False
