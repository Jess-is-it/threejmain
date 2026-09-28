from datetime import datetime, timezone
from typing import Any, Callable
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from .storage import InventoryPostgresStore, LOCATION_TYPES, canonical_fingerprint


router = APIRouter(prefix="/api/inventory", tags=["inventory"])

items: list[dict[str, Any]] = []
movements: list[dict[str, Any]] = []
assignments: list[dict[str, Any]] = []
locations: list[dict[str, Any]] = []

inventory_store = InventoryPostgresStore()

_current_admin: Callable[[str | None], dict[str, Any]] | None = None
_audit_logger: Callable[[str, str, str, dict[str, Any] | None, str], None] | None = None

ITEM_CATEGORIES = ["ROUTER", "ONU_CPE", "CABLE", "INSTALLATION_MATERIAL", "CONSUMABLE", "TOOL", "OFFICE_SUPPLY", "SERVICE", "OTHER"]
TRACKING_TYPES = ["STOCK", "SERIALIZED", "NON_STOCK"]
ITEM_STATUSES = ["ACTIVE", "INACTIVE", "ARCHIVED"]
MOVEMENT_TYPES = ["RECEIVE", "ISSUE", "ADJUST", "TRANSFER", "RETURN"]
ASSIGNMENT_STATUSES = ["ASSIGNED", "RETURNED", "LOST", "DAMAGED"]
ASSIGNEE_TYPES = ["CUSTOMER", "TECHNICIAN", "OFFICE", "INTERNAL", "OTHER"]


class ItemPayload(BaseModel):
    sku: str | None = None
    name: str | None = None
    category: str | None = None
    trackingType: str | None = None
    unit: str | None = None
    quantityOnHand: float | None = Field(default=None, ge=0)
    reorderPoint: float | None = Field(default=None, ge=0)
    location: str | None = None
    supplier: str | None = None
    unitCost: float | None = Field(default=None, ge=0)
    salePrice: float | None = Field(default=None, ge=0)
    taxable: bool | None = None
    sellableInPos: bool | None = None
    barcode: str | None = None
    status: str | None = None
    serialNumbers: list[str] | None = None
    notes: str | None = None


class MovementPayload(BaseModel):
    itemId: str | None = None
    type: str | None = None
    quantity: float | None = Field(default=None, gt=0)
    serialNumber: str | None = None
    fromLocation: str | None = None
    toLocation: str | None = None
    referenceType: str | None = None
    referenceId: str | None = None
    notes: str | None = None


class AssignmentPayload(BaseModel):
    itemId: str | None = None
    serialNumber: str | None = None
    quantity: float | None = Field(default=None, gt=0)
    assigneeType: str | None = None
    assignedToName: str | None = None
    customerId: str | None = None
    serviceId: str | None = None
    ticketId: str | None = None
    location: str | None = None
    status: str | None = None
    assignedDate: str | None = None
    dueDate: str | None = None
    returnedDate: str | None = None
    notes: str | None = None


class LocationPayload(BaseModel):
    code: str | None = None
    name: str | None = None
    type: str | None = None
    parentLocationId: str | None = None
    active: bool | None = None
    notes: str | None = None


class MovementReversalPayload(BaseModel):
    reason: str | None = None


def configure_inventory(
    current_admin: Callable[[str | None], dict[str, Any]],
    audit_logger: Callable[[str, str, str, dict[str, Any] | None, str], None],
) -> None:
    global _current_admin, _audit_logger
    _current_admin = current_admin
    _audit_logger = audit_logger


def require_admin(authorization: str | None = Header(default=None)):
    if _current_admin is None:
        raise HTTPException(status_code=500, detail="Inventory module is not configured")
    return _current_admin(authorization)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def today_iso() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def normalize_upper(value: Any) -> str:
    return str(value or "").strip().upper()


def clean_text(value: Any) -> str:
    return str(value or "").strip()


def number(value: Any) -> float:
    return round(float(value or 0), 2)


def add_audit(action: str, target_type: str, target_id: str, details: dict[str, Any] | None, actor: str) -> None:
    if _audit_logger is not None:
        _audit_logger(action, target_type, target_id, details, actor)


def visible_items() -> list[dict[str, Any]]:
    return [item for item in items if not item.get("deletedAt")]


def visible_movements() -> list[dict[str, Any]]:
    return [movement for movement in movements if not movement.get("deletedAt")]


def visible_assignments() -> list[dict[str, Any]]:
    return [assignment for assignment in assignments if not assignment.get("deletedAt")]


def find_row(rows: list[dict[str, Any]], row_id: str, label: str) -> dict[str, Any]:
    for row in rows:
        if row["id"] == row_id and not row.get("deletedAt"):
            return row
    raise HTTPException(status_code=404, detail=f"{label} not found")


def find_item(item_id: str) -> dict[str, Any]:
    return find_row(items, item_id, "Inventory item")


def find_movement(movement_id: str) -> dict[str, Any]:
    return find_row(movements, movement_id, "Stock movement")


def find_assignment(assignment_id: str) -> dict[str, Any]:
    return find_row(assignments, assignment_id, "Asset assignment")


def next_sku(category: str, row_count: int | None = None) -> str:
    prefix = {
        "ROUTER": "RTR",
        "ONU_CPE": "ONU",
        "CABLE": "CBL",
        "INSTALLATION_MATERIAL": "MAT",
        "CONSUMABLE": "CON",
        "TOOL": "TOL",
        "OFFICE_SUPPLY": "OFF",
        "SERVICE": "SVC",
    }.get(category, "INV")
    return f"{prefix}-{(len(items) if row_count is None else row_count) + 1:04d}"


def item_summary(item: dict[str, Any]) -> dict[str, Any]:
    stock_tracked = item.get("trackingType") != "NON_STOCK"
    available = number(item["quantityOnHand"] - assigned_quantity(item["id"])) if stock_tracked else 0
    return {
        **item,
        "stockTracked": stock_tracked,
        "assignedQuantity": assigned_quantity(item["id"]),
        "availableQuantity": max(0, available),
        "stockValue": number(item["quantityOnHand"] * item["unitCost"]) if stock_tracked else 0,
        "lowStock": stock_tracked and item["status"] == "ACTIVE" and item["quantityOnHand"] <= item["reorderPoint"],
    }


def normalize_item_payload(
    payload: ItemPayload,
    current: dict[str, Any] | None = None,
    candidate_items: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    record = dict(current or {})
    record.update({key: value for key, value in data.items() if value is not None})
    if not clean_text(record.get("name")):
        raise HTTPException(status_code=400, detail="Item name is required")
    record["name"] = clean_text(record["name"])
    record["category"] = normalize_upper(record.get("category") or "OTHER")
    record["trackingType"] = normalize_upper(record.get("trackingType") or "STOCK")
    record["status"] = normalize_upper(record.get("status") or "ACTIVE")
    if record["category"] not in ITEM_CATEGORIES:
        raise HTTPException(status_code=400, detail="Invalid item category")
    if record["trackingType"] not in TRACKING_TYPES:
        raise HTTPException(status_code=400, detail="Invalid tracking type")
    if record["status"] not in ITEM_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid item status")
    candidates = visible_items() if candidate_items is None else candidate_items
    record["sku"] = clean_text(record.get("sku")) or next_sku(record["category"], len(candidates))
    duplicate = next((item for item in candidates if item["sku"].lower() == record["sku"].lower() and item.get("id") != record.get("id")), None)
    if duplicate:
        raise HTTPException(status_code=400, detail="SKU already exists")
    record["unit"] = clean_text(record.get("unit")) or ("unit" if record["trackingType"] in ["SERIALIZED", "NON_STOCK"] else "pcs")
    record["quantityOnHand"] = number(record.get("quantityOnHand"))
    record["reorderPoint"] = number(record.get("reorderPoint"))
    record["unitCost"] = number(record.get("unitCost"))
    record["salePrice"] = number(record.get("salePrice"))
    record["taxable"] = bool(record.get("taxable", False))
    record["sellableInPos"] = bool(record.get("sellableInPos", False))
    record["barcode"] = clean_text(record.get("barcode"))
    record["location"] = clean_text(record.get("location")) or "Main stockroom"
    record["supplier"] = clean_text(record.get("supplier"))
    record["notes"] = clean_text(record.get("notes"))
    record["serialNumbers"] = [clean_text(value) for value in record.get("serialNumbers", []) if clean_text(value)]
    if record["trackingType"] == "NON_STOCK":
        record["quantityOnHand"] = 0
        record["reorderPoint"] = 0
        record["serialNumbers"] = []
    if record["trackingType"] == "SERIALIZED" and record["serialNumbers"]:
        record["quantityOnHand"] = max(record["quantityOnHand"], float(len(record["serialNumbers"])))
    return record


def assigned_quantity(item_id: str) -> float:
    return number(
        sum(
            assignment["quantity"]
            for assignment in visible_assignments()
            if assignment["itemId"] == item_id and assignment["status"] == "ASSIGNED"
        )
    )


def movement_delta(movement_type: str, quantity: float) -> float:
    if movement_type in ["RECEIVE", "RETURN"]:
        return quantity
    if movement_type == "ISSUE":
        return -quantity
    return 0


def apply_movement_changes(previous: dict[str, Any] | None = None, next_record: dict[str, Any] | None = None) -> None:
    deltas: dict[str, float] = {}
    if previous is not None:
        deltas[previous["itemId"]] = deltas.get(previous["itemId"], 0) - movement_delta(previous["type"], previous["quantity"])
    if next_record is not None:
        deltas[next_record["itemId"]] = deltas.get(next_record["itemId"], 0) + movement_delta(next_record["type"], next_record["quantity"])
    items_by_id = {item["id"]: item for item in visible_items()}
    for item_id, delta in deltas.items():
        item = items_by_id[item_id]
        if number(item["quantityOnHand"] + delta) < 0:
            raise HTTPException(status_code=400, detail="Movement would make stock negative")
    timestamp = now_iso()
    for item_id, delta in deltas.items():
        item = items_by_id[item_id]
        if item.get("trackingType") == "NON_STOCK":
            continue
        item["quantityOnHand"] = number(item["quantityOnHand"] + delta)
        item["updatedAt"] = timestamp


def normalize_movement_payload(
    payload: MovementPayload,
    current: dict[str, Any] | None = None,
    item_override: dict[str, Any] | None = None,
) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    record = dict(current or {})
    record.update({key: value for key, value in data.items() if value is not None})
    if not record.get("itemId"):
        raise HTTPException(status_code=400, detail="itemId is required")
    item = item_override or find_item(record["itemId"])
    if item.get("trackingType") == "NON_STOCK":
        raise HTTPException(status_code=400, detail="Non-stock items do not use inventory movements")
    record["item"] = {"id": item["id"], "sku": item["sku"], "name": item["name"], "unit": item["unit"]}
    record["type"] = normalize_upper(record.get("type") or "RECEIVE")
    if record["type"] not in MOVEMENT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid movement type")
    record["quantity"] = number(record.get("quantity"))
    if record["quantity"] <= 0:
        raise HTTPException(status_code=400, detail="Movement quantity must be greater than zero")
    record["serialNumber"] = clean_text(record.get("serialNumber"))
    if record["serialNumber"] and item.get("serialNumbers") and record["serialNumber"] not in item["serialNumbers"]:
        raise HTTPException(status_code=400, detail="serialNumber is not registered on this item")
    record["fromLocation"] = clean_text(record.get("fromLocation"))
    record["toLocation"] = clean_text(record.get("toLocation"))
    if record["type"] in ["RECEIVE", "RETURN"] and not record["toLocation"]:
        record["toLocation"] = item["location"]
    if record["type"] == "ADJUST" and not record["fromLocation"] and not record["toLocation"]:
        record["toLocation"] = item["location"]
    record["referenceType"] = clean_text(record.get("referenceType")) or "MANUAL"
    record["referenceId"] = clean_text(record.get("referenceId"))
    record["notes"] = clean_text(record.get("notes"))
    return record


def normalize_assignment_payload(
    payload: AssignmentPayload,
    current: dict[str, Any] | None = None,
    item_override: dict[str, Any] | None = None,
    available_quantity_override: float | None = None,
) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    record = dict(current or {})
    record.update({key: value for key, value in data.items() if value is not None})
    if not record.get("itemId"):
        raise HTTPException(status_code=400, detail="itemId is required")
    item = item_override or find_item(record["itemId"])
    if item.get("trackingType") == "NON_STOCK":
        raise HTTPException(status_code=400, detail="Non-stock items cannot be assigned")
    record["item"] = {"id": item["id"], "sku": item["sku"], "name": item["name"], "unit": item["unit"], "trackingType": item["trackingType"]}
    record["assigneeType"] = normalize_upper(record.get("assigneeType") or "CUSTOMER")
    if record["assigneeType"] not in ASSIGNEE_TYPES:
        raise HTTPException(status_code=400, detail="Invalid assignee type")
    record["status"] = normalize_upper(record.get("status") or "ASSIGNED")
    if record["status"] not in ASSIGNMENT_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid assignment status")
    record["quantity"] = number(record.get("quantity") or 1)
    if record["quantity"] <= 0:
        raise HTTPException(status_code=400, detail="Assignment quantity must be greater than zero")
    record["serialNumber"] = clean_text(record.get("serialNumber"))
    if item["trackingType"] == "SERIALIZED":
        if not record["serialNumber"]:
            raise HTTPException(status_code=400, detail="serialNumber is required for serialized items")
        if item.get("serialNumbers") and record["serialNumber"] not in item["serialNumbers"]:
            raise HTTPException(status_code=400, detail="serialNumber is not registered on this item")
    current_quantity = number(current.get("quantity")) if current and current.get("itemId") == item["id"] else 0
    available_quantity = item_summary(item)["availableQuantity"] if available_quantity_override is None else number(available_quantity_override)
    if record["status"] == "ASSIGNED" and record["quantity"] > available_quantity + current_quantity:
        raise HTTPException(status_code=400, detail="Not enough available stock for assignment")
    record["assignedToName"] = clean_text(record.get("assignedToName")) or "Unlinked customer placeholder"
    record["customerId"] = clean_text(record.get("customerId"))
    record["serviceId"] = clean_text(record.get("serviceId"))
    record["ticketId"] = clean_text(record.get("ticketId"))
    record["location"] = clean_text(record.get("location")) or item["location"]
    record["assignedDate"] = clean_text(record.get("assignedDate")) or today_iso()
    record["dueDate"] = clean_text(record.get("dueDate"))
    record["returnedDate"] = clean_text(record.get("returnedDate"))
    record["notes"] = clean_text(record.get("notes"))
    return record


def filter_items(search: str = "", category: str = "", status: str = "", lowStock: bool = False) -> list[dict[str, Any]]:
    rows = [item_summary(item) for item in visible_items()]
    if category:
        rows = [item for item in rows if item["category"] == normalize_upper(category)]
    if status:
        rows = [item for item in rows if item["status"] == normalize_upper(status)]
    if lowStock:
        rows = [item for item in rows if item["lowStock"]]
    if search:
        needle = search.lower().strip()
        rows = [
            item
            for item in rows
            if needle in item["sku"].lower()
            or needle in item["name"].lower()
            or needle in item["category"].lower()
            or needle in item["location"].lower()
            or needle in item["supplier"].lower()
            or needle in str(item.get("barcode", "")).lower()
        ]
    return rows


def filter_child_rows(rows: list[dict[str, Any]], search: str = "", itemId: str = "", status: str = "", row_type: str = "") -> list[dict[str, Any]]:
    filtered = rows
    if itemId:
        filtered = [row for row in filtered if row.get("itemId") == itemId]
    if status:
        filtered = [row for row in filtered if normalize_upper(row.get("status")) == normalize_upper(status)]
    if row_type:
        filtered = [row for row in filtered if normalize_upper(row.get("type")) == normalize_upper(row_type)]
    if search:
        needle = search.lower().strip()
        filtered = [
            row
            for row in filtered
            if needle in str(row.get("item", {}).get("name", "")).lower()
            or needle in str(row.get("item", {}).get("sku", "")).lower()
            or needle in str(row.get("assignedToName", "")).lower()
            or needle in str(row.get("referenceId", "")).lower()
            or needle in str(row.get("serialNumber", "")).lower()
        ]
    return filtered


def pos_item_snapshot(item: dict[str, Any]) -> dict[str, Any]:
    summary = item if "availableQuantity" in item else item_summary(item)
    return {
        "id": summary["id"],
        "sku": summary["sku"],
        "name": summary["name"],
        "category": summary["category"],
        "unit": summary["unit"],
        "unitPrice": number(summary.get("salePrice")),
        "unitCost": summary["unitCost"],
        "salePrice": number(summary.get("salePrice")),
        "taxable": bool(summary.get("taxable", False)),
        "barcode": summary.get("barcode", ""),
        "stockOnHand": summary["availableQuantity"],
        "quantityOnHand": summary["quantityOnHand"],
        "availableQuantity": summary["availableQuantity"],
        "reorderPoint": summary["reorderPoint"],
        "trackingType": summary["trackingType"],
        "stockTracked": summary["stockTracked"],
        "sellableInPos": bool(summary.get("sellableInPos", False)),
        "location": summary["location"],
        "status": summary["status"],
        "notes": summary.get("notes", ""),
    }


def list_pos_catalog_items(search: str = "", status: str = "ACTIVE", connection=None) -> list[dict[str, Any]]:
    if inventory_store.postgres_enabled:
        rows = [item for item in inventory_store.list_items(connection=connection) if item.get("sellableInPos")]
        if status:
            rows = [item for item in rows if item["status"] == normalize_upper(status)]
        if search:
            needle = search.lower().strip()
            rows = [
                item
                for item in rows
                if needle in item["sku"].lower()
                or needle in item["name"].lower()
                or needle in item["category"].lower()
                or needle in str(item.get("barcode", "")).lower()
            ]
        return [pos_item_snapshot(item) for item in sorted(rows, key=lambda row: row["name"])]
    seed_inventory_data()
    rows = [item_summary(item) for item in visible_items() if item.get("sellableInPos")]
    if status:
        rows = [item for item in rows if item["status"] == normalize_upper(status)]
    if search:
        needle = search.lower().strip()
        rows = [
            item
            for item in rows
            if needle in item["sku"].lower()
            or needle in item["name"].lower()
            or needle in item["category"].lower()
            or needle in str(item.get("barcode", "")).lower()
        ]
    return [pos_item_snapshot(item) for item in sorted(rows, key=lambda row: row["name"])]


def get_pos_catalog_item(item_id: str, connection=None) -> dict[str, Any]:
    if inventory_store.postgres_enabled:
        item = inventory_store.get_item(item_id, connection=connection)
        if not item.get("sellableInPos") or item.get("status") != "ACTIVE":
            raise HTTPException(status_code=400, detail="Inventory item is not active in POS")
        return pos_item_snapshot(item)
    seed_inventory_data()
    item = find_item(item_id)
    if not item.get("sellableInPos") or item.get("status") != "ACTIVE":
        raise HTTPException(status_code=400, detail="Inventory item is not active in POS")
    return pos_item_snapshot(item)


def serialized_item_unavailable(item_id: str, serial_number: str, connection=None) -> bool:
    if inventory_store.postgres_enabled:
        return inventory_store.serial_unavailable(item_id, serial_number, connection=connection)
    assigned_serial = next(
        (
            assignment
            for assignment in visible_assignments()
            if assignment["itemId"] == item_id
            and assignment["status"] == "ASSIGNED"
            and clean_text(assignment.get("serialNumber")) == serial_number
        ),
        None,
    )
    if assigned_serial:
        return True
    serial_delta = number(
        sum(
            movement_delta(movement["type"], movement["quantity"])
            for movement in visible_movements()
            if movement["itemId"] == item_id and clean_text(movement.get("serialNumber")) == serial_number
        )
    )
    return serial_delta < 0


def validate_pos_sale_inventory(
    line_items: list[dict[str, Any]],
    released_line_items: list[dict[str, Any]] | None = None,
    connection=None,
) -> None:
    seed_inventory_data()
    required_by_item: dict[str, float] = {}
    released_by_item: dict[str, float] = {}
    released_serials = {
        (line.get("itemId"), clean_text(line.get("serialNumber")))
        for line in released_line_items or []
        if line.get("itemId") and clean_text(line.get("serialNumber"))
    }
    for line in released_line_items or []:
        item_id = line.get("itemId")
        if not item_id:
            continue
        item = inventory_store.get_item(item_id, connection=connection) if inventory_store.postgres_enabled else find_item(item_id)
        if item.get("trackingType") != "NON_STOCK":
            released_by_item[item_id] = number(released_by_item.get(item_id, 0) + number(line.get("quantity")))

    serialized_lines: set[tuple[str, str]] = set()
    for line in line_items:
        item_id = line.get("itemId")
        if not item_id:
            continue
        item = inventory_store.get_item(item_id, connection=connection) if inventory_store.postgres_enabled else find_item(item_id)
        snapshot = get_pos_catalog_item(item_id, connection=connection)
        if not snapshot["stockTracked"]:
            continue
        quantity = number(line.get("quantity"))
        if item.get("trackingType") == "SERIALIZED":
            serial_number = clean_text(line.get("serialNumber"))
            if quantity != 1:
                raise HTTPException(status_code=400, detail=f"Serialized item {item['sku']} must be sold one unit per line")
            if not serial_number:
                raise HTTPException(status_code=400, detail=f"Serial number is required for {item['sku']}")
            if item.get("serialNumbers") and serial_number not in item["serialNumbers"]:
                raise HTTPException(status_code=400, detail=f"Serial number is not registered for {item['sku']}")
            serial_key = (item_id, serial_number)
            if serial_key in serialized_lines:
                raise HTTPException(status_code=400, detail=f"Serial number {serial_number} is duplicated in this sale")
            serialized_lines.add(serial_key)
            if serial_key not in released_serials and serialized_item_unavailable(item_id, serial_number, connection=connection):
                raise HTTPException(status_code=400, detail=f"Serial number {serial_number} is unavailable")
        required_by_item[item_id] = number(required_by_item.get(item_id, 0) + quantity)

    for item_id, required in required_by_item.items():
        item = get_pos_catalog_item(item_id, connection=connection)
        if required > number(item["availableQuantity"] + released_by_item.get(item_id, 0)):
            raise HTTPException(status_code=400, detail=f"Not enough available inventory for {item['sku']}")


def record_pos_sale_movements(
    line_items: list[dict[str, Any]],
    sale_reference: str,
    receipt_number: str,
    actor: str,
    reverse: bool = False,
    connection=None,
    idempotency_prefix: str = "",
) -> list[dict[str, Any]]:
    if inventory_store.postgres_enabled:
        if not reverse:
            validate_pos_sale_inventory(line_items, connection=connection)
        created: list[dict[str, Any]] = []
        movement_type = "RETURN" if reverse else "ISSUE"
        reference_type = "POS_VOID" if reverse else "POS_SALE"
        operation_key = clean_text(idempotency_prefix) or f"{reference_type}:{receipt_number or sale_reference}"
        with inventory_store.transaction(connection) as conn:
            for index, line in enumerate(line_items):
                item_id = clean_text(line.get("itemId"))
                if not item_id:
                    continue
                item = inventory_store.get_item(item_id, connection=conn, for_update=True)
                if item.get("trackingType") == "NON_STOCK":
                    continue
                movement = inventory_store._post_movement(
                    conn,
                    {
                        "itemId": item_id,
                        "type": movement_type,
                        "quantity": number(line.get("quantity")),
                        "serialNumber": clean_text(line.get("serialNumber")),
                        "fromLocationId": item.get("locationId") if not reverse else "",
                        "toLocationId": item.get("locationId") if reverse else "",
                        "referenceType": reference_type,
                        "referenceId": receipt_number or sale_reference,
                        "notes": f"{'Reversal for' if reverse else 'Posted from'} POS sale {sale_reference}",
                    },
                    actor=actor,
                    idempotency_key=f"inventory-pos:{operation_key}:{index}:{item_id}:{clean_text(line.get('serialNumber')) or '-'}",
                )
                created.append(movement)
        return created
    seed_inventory_data()
    if not reverse:
        validate_pos_sale_inventory(line_items)
    created: list[dict[str, Any]] = []
    timestamp = now_iso()
    movement_type = "RETURN" if reverse else "ISSUE"
    reference_type = "POS_VOID" if reverse else "POS_SALE"
    for line in line_items:
        item_id = line.get("itemId")
        if not item_id:
            continue
        item = find_item(item_id)
        if item.get("trackingType") == "NON_STOCK":
            continue
        quantity = number(line.get("quantity"))
        record = normalize_movement_payload(
            MovementPayload(
                itemId=item_id,
                type=movement_type,
                quantity=quantity,
                serialNumber=clean_text(line.get("serialNumber")),
                fromLocation=item["location"] if not reverse else "",
                toLocation=item["location"],
                referenceType=reference_type,
                referenceId=receipt_number or sale_reference,
                notes=f"{'Reversal for' if reverse else 'Posted from'} POS sale {sale_reference}{' serial ' + clean_text(line.get('serialNumber')) if clean_text(line.get('serialNumber')) else ''}",
            )
        )
        apply_movement_changes(next_record=record)
        movement = {"id": str(uuid4()), "createdAt": timestamp, "updatedAt": timestamp, "deletedAt": None, **record}
        movements.append(movement)
        created.append(movement)
        add_audit("inventory_pos_sale_reversed" if reverse else "inventory_pos_sale_issued", "InventoryMovement", movement["id"], {"itemId": item_id, "referenceId": receipt_number}, actor)
    return created


def inventory_metrics() -> dict[str, float | int]:
    seed_inventory_data()
    if inventory_store.postgres_enabled:
        item_rows = inventory_store.list_items()
        assignment_rows = inventory_store.list_assignments()
    else:
        item_rows = [item_summary(item) for item in visible_items()]
        assignment_rows = visible_assignments()
    return {
        "items": len(item_rows),
        "active_items": sum(1 for item in item_rows if item["status"] == "ACTIVE"),
        "low_stock": sum(1 for item in item_rows if item["lowStock"]),
        "out_of_stock": sum(1 for item in item_rows if item["stockTracked"] and item["quantityOnHand"] <= 0),
        "assigned_assets": sum(1 for assignment in assignment_rows if assignment["status"] == "ASSIGNED"),
        "stock_value": number(sum(item["stockValue"] for item in item_rows)),
    }


def seed_inventory_data() -> None:
    timestamp = now_iso()
    seed_rows = [
        {
            "sku": "ONU-0001",
            "name": "Fiber ONU dual-band CPE",
            "category": "ONU_CPE",
            "trackingType": "SERIALIZED",
            "unit": "unit",
            "quantityOnHand": 8,
            "reorderPoint": 3,
            "location": "Main stockroom",
            "supplier": "Default supplier",
            "unitCost": 1250,
            "salePrice": 0,
            "taxable": False,
            "sellableInPos": False,
            "barcode": "ONU-0001",
            "status": "ACTIVE",
            "serialNumbers": ["ONU-A1001", "ONU-A1002", "ONU-A1003"],
            "notes": "Seed serialized CPE stock.",
        },
        {
            "sku": "CBL-0002",
            "name": "Drop fiber cable",
            "category": "CABLE",
            "trackingType": "STOCK",
            "unit": "meters",
            "quantityOnHand": 450,
            "reorderPoint": 100,
            "location": "Cable rack",
            "supplier": "Default supplier",
            "unitCost": 8.5,
            "salePrice": 18,
            "taxable": False,
            "sellableInPos": True,
            "barcode": "CBL-0002",
            "status": "ACTIVE",
            "serialNumbers": [],
            "notes": "Seed cable stock.",
        },
        {
            "sku": "RTR-0003",
            "name": "Home WiFi router",
            "category": "ROUTER",
            "trackingType": "SERIALIZED",
            "unit": "unit",
            "quantityOnHand": 2,
            "reorderPoint": 3,
            "location": "Main stockroom",
            "supplier": "Default supplier",
            "unitCost": 950,
            "salePrice": 1450,
            "taxable": False,
            "sellableInPos": True,
            "barcode": "RTR-0003",
            "status": "ACTIVE",
            "serialNumbers": ["RTR-W1001", "RTR-W1002"],
            "notes": "Low-stock seed router line.",
        },
        {
            "sku": "SVC-INSTALL",
            "name": "Standard installation fee",
            "category": "SERVICE",
            "trackingType": "NON_STOCK",
            "unit": "service",
            "quantityOnHand": 0,
            "reorderPoint": 0,
            "location": "Service desk",
            "supplier": "",
            "unitCost": 0,
            "salePrice": 1500,
            "taxable": False,
            "sellableInPos": True,
            "barcode": "SVC-INSTALL",
            "status": "ACTIVE",
            "serialNumbers": [],
            "notes": "Non-stock service charge available in POS.",
        },
        {
            "sku": "TOL-0004",
            "name": "Fiber crimping tool",
            "category": "TOOL",
            "trackingType": "SERIALIZED",
            "unit": "unit",
            "quantityOnHand": 4,
            "reorderPoint": 1,
            "location": "Technician cage",
            "supplier": "Default supplier",
            "unitCost": 1800,
            "salePrice": 0,
            "taxable": False,
            "sellableInPos": False,
            "barcode": "TOL-0004",
            "status": "ACTIVE",
            "serialNumbers": ["TOOL-CRIMP-01", "TOOL-CRIMP-02", "TOOL-CRIMP-03", "TOOL-CRIMP-04"],
            "notes": "Technician-borrowable office/field tool, not a POS sale item.",
        },
    ]
    if inventory_store.postgres_enabled:
        inventory_store.seed_items(seed_rows)
        return
    if items:
        return
    if not locations:
        locations.extend(
            [
                {"id": "inventory-location-main", "code": "MAIN", "name": "Main stockroom", "type": "WAREHOUSE", "parentLocationId": "", "active": True, "createdAt": timestamp, "updatedAt": timestamp},
                {"id": "inventory-location-transit", "code": "TRANSIT", "name": "In transit", "type": "TRANSIT", "parentLocationId": "", "active": True, "createdAt": timestamp, "updatedAt": timestamp},
                {"id": "inventory-location-damaged", "code": "DAMAGED", "name": "Damaged and quarantine", "type": "DAMAGED", "parentLocationId": "", "active": True, "createdAt": timestamp, "updatedAt": timestamp},
            ]
        )
    for row in seed_rows:
        items.append({"id": str(uuid4()), "createdAt": timestamp, "updatedAt": timestamp, "deletedAt": None, **row})


@router.get("/meta")
def inventory_meta(admin=Depends(require_admin)):
    return {
        "itemCategories": ITEM_CATEGORIES,
        "trackingTypes": TRACKING_TYPES,
        "itemStatuses": ITEM_STATUSES,
        "movementTypes": MOVEMENT_TYPES,
        "locationTypes": LOCATION_TYPES,
        "assignmentStatuses": ASSIGNMENT_STATUSES,
        "assigneeTypes": ASSIGNEE_TYPES,
        "storage": "postgres" if inventory_store.postgres_enabled else "memory",
        "movementLedger": "append-only",
        "integrationPlaceholders": {
            "customerId": "Customer Profiling link placeholder",
            "serviceId": "Customer service assignment link placeholder",
            "ticketId": "Ticketing/field job link placeholder",
            "referenceId": "Billing, POS, Ticketing, or manual document reference placeholder",
        },
    }


@router.get("/readiness")
def inventory_readiness(admin=Depends(require_admin)):
    storage = inventory_store.status() if inventory_store.postgres_enabled else {
        "mode": "memory",
        "ready": False,
        "reason": "DATABASE_URL or INVENTORY_STORAGE=postgres is required for durable Inventory data",
    }
    return {
        "module": "inventory",
        "realDataReady": storage.get("ready") is True and storage.get("mode") == "postgres",
        "storage": storage,
        "transactionControls": {
            "advisoryLock": inventory_store.postgres_enabled,
            "rowLockedBalances": inventory_store.postgres_enabled,
            "idempotentMovements": True,
            "appendOnlyLedger": True,
        },
    }


@router.get("/overview")
def inventory_overview(admin=Depends(require_admin)):
    seed_inventory_data()
    if inventory_store.postgres_enabled:
        item_rows = inventory_store.list_items()
        movement_rows = inventory_store.list_movements()
        assignment_rows = inventory_store.list_assignments()
    else:
        item_rows = [item_summary(item) for item in visible_items()]
        movement_rows = visible_movements()
        assignment_rows = visible_assignments()
    return {
        "metrics": inventory_metrics(),
        "lowStockItems": [item for item in item_rows if item["lowStock"]][:8],
        "recentMovements": sorted(movement_rows, key=lambda row: row["createdAt"], reverse=True)[:8],
        "activeAssignments": [assignment for assignment in assignment_rows if assignment["status"] == "ASSIGNED"][:8],
    }


@router.get("/items")
def list_items(search: str = "", category: str = "", status: str = "", lowStock: bool = False, admin=Depends(require_admin)):
    seed_inventory_data()
    if inventory_store.postgres_enabled:
        rows = inventory_store.list_items()
        if category:
            rows = [item for item in rows if item["category"] == normalize_upper(category)]
        if status:
            rows = [item for item in rows if item["status"] == normalize_upper(status)]
        if lowStock:
            rows = [item for item in rows if item["lowStock"]]
        if search:
            needle = search.lower().strip()
            rows = [
                item
                for item in rows
                if needle in item["sku"].lower()
                or needle in item["name"].lower()
                or needle in item["category"].lower()
                or needle in item["location"].lower()
                or needle in str(item.get("supplier", "")).lower()
                or needle in str(item.get("barcode", "")).lower()
            ]
        return rows
    return sorted(filter_items(search, category, status, lowStock), key=lambda row: row["updatedAt"], reverse=True)


@router.post("/items")
def create_item(payload: ItemPayload, admin=Depends(require_admin)):
    if inventory_store.postgres_enabled:
        record = normalize_item_payload(payload, candidate_items=inventory_store.list_items())
        item = inventory_store.create_item(record, actor=admin["username"])
        add_audit("inventory_item_created", "InventoryItem", item["id"], {"sku": item["sku"], "locationId": item.get("locationId")}, admin["username"])
        return item
    record = normalize_item_payload(payload)
    timestamp = now_iso()
    item = {"id": str(uuid4()), "createdAt": timestamp, "updatedAt": timestamp, "deletedAt": None, **record}
    items.append(item)
    add_audit("inventory_item_created", "InventoryItem", item["id"], {"sku": item["sku"]}, admin["username"])
    return item_summary(item)


@router.patch("/items/{item_id}")
def update_item(item_id: str, payload: ItemPayload, admin=Depends(require_admin)):
    if inventory_store.postgres_enabled:
        current = inventory_store.get_item(item_id)
        record = normalize_item_payload(payload, current, candidate_items=inventory_store.list_items())
        item = inventory_store.update_item(
            item_id,
            record,
            actor=admin["username"],
            quantity_was_supplied="quantityOnHand" in payload.model_fields_set,
        )
        add_audit("inventory_item_updated", "InventoryItem", item["id"], {"sku": item["sku"]}, admin["username"])
        return item
    current = find_item(item_id)
    record = normalize_item_payload(payload, current)
    current.update(record)
    current["updatedAt"] = now_iso()
    add_audit("inventory_item_updated", "InventoryItem", current["id"], {"sku": current["sku"]}, admin["username"])
    return item_summary(current)


@router.delete("/items/{item_id}")
def delete_item(item_id: str, admin=Depends(require_admin)):
    if inventory_store.postgres_enabled:
        current = inventory_store.get_item(item_id)
        result = inventory_store.archive_item(item_id)
        add_audit("inventory_item_archived", "InventoryItem", item_id, {"sku": current["sku"]}, admin["username"])
        return result
    current = find_item(item_id)
    if any(movement["itemId"] == item_id for movement in visible_movements()) or any(
        assignment["itemId"] == item_id and assignment["status"] == "ASSIGNED" for assignment in visible_assignments()
    ):
        current["status"] = "ARCHIVED"
    current["deletedAt"] = now_iso()
    current["updatedAt"] = current["deletedAt"]
    add_audit("inventory_item_deleted", "InventoryItem", current["id"], {"sku": current["sku"]}, admin["username"])
    return {"status": "ok"}


@router.get("/movements")
def list_movements(search: str = "", itemId: str = "", type: str = "", admin=Depends(require_admin)):
    seed_inventory_data()
    source_rows = inventory_store.list_movements() if inventory_store.postgres_enabled else visible_movements()
    rows = filter_child_rows(source_rows, search=search, itemId=itemId, row_type=type)
    return sorted(rows, key=lambda row: row["createdAt"], reverse=True)


@router.post("/movements")
def create_movement(
    payload: MovementPayload,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    admin=Depends(require_admin),
):
    posting_key = clean_text(idempotency_key)
    if not posting_key:
        raise HTTPException(status_code=400, detail="Idempotency-Key header is required")
    if inventory_store.postgres_enabled:
        item = inventory_store.get_item(clean_text(payload.itemId))
        record = normalize_movement_payload(payload, item_override=item)
        movement = inventory_store.post_movement(record, actor=admin["username"], idempotency_key=posting_key)
        add_audit(
            "inventory_movement_posted",
            "InventoryMovement",
            movement["id"],
            {"itemId": movement["itemId"], "type": movement["type"], "idempotentReplay": movement.get("idempotentReplay", False)},
            admin["username"],
        )
        return movement
    record = normalize_movement_payload(payload)
    fingerprint = canonical_fingerprint({key: record.get(key) for key in ["itemId", "type", "quantity", "serialNumber", "fromLocation", "toLocation", "referenceType", "referenceId"]})
    existing = next((row for row in movements if row.get("idempotencyKey") == posting_key), None)
    if existing:
        if existing.get("requestFingerprint") != fingerprint:
            raise HTTPException(status_code=409, detail="Idempotency-Key was already used with a different Inventory movement")
        return {**existing, "idempotentReplay": True}
    apply_movement_changes(next_record=record)
    timestamp = now_iso()
    movement = {
        "id": str(uuid4()),
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deletedAt": None,
        "idempotencyKey": posting_key,
        "requestFingerprint": fingerprint,
        "immutable": True,
        **record,
    }
    movements.append(movement)
    add_audit("inventory_movement_created", "InventoryMovement", movement["id"], {"itemId": movement["itemId"], "type": movement["type"]}, admin["username"])
    return movement


@router.patch("/movements/{movement_id}")
def update_movement(movement_id: str, payload: MovementPayload, admin=Depends(require_admin)):
    raise HTTPException(status_code=405, detail="Inventory movements are immutable; post a reversal instead")


@router.delete("/movements/{movement_id}")
def delete_movement(movement_id: str, admin=Depends(require_admin)):
    raise HTTPException(status_code=405, detail="Inventory movements are immutable; post a reversal instead")


@router.post("/movements/{movement_id}/reverse")
def reverse_movement(
    movement_id: str,
    payload: MovementReversalPayload,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    admin=Depends(require_admin),
):
    posting_key = clean_text(idempotency_key)
    if not posting_key:
        raise HTTPException(status_code=400, detail="Idempotency-Key header is required")
    if inventory_store.postgres_enabled:
        movement = inventory_store.reverse_movement(
            movement_id,
            actor=admin["username"],
            idempotency_key=posting_key,
            notes=clean_text(payload.reason),
        )
        add_audit("inventory_movement_reversed", "InventoryMovement", movement["id"], {"reversalOfId": movement_id}, admin["username"])
        return movement
    original = find_movement(movement_id)
    if original.get("reversalOfId"):
        raise HTTPException(status_code=409, detail="A reversal movement cannot itself be reversed")
    if original["type"] in ["RECEIVE", "RETURN"]:
        movement_type, from_location, to_location = "ISSUE", original.get("toLocation"), ""
    elif original["type"] == "ISSUE":
        movement_type, from_location, to_location = "RETURN", "", original.get("fromLocation")
    elif original["type"] == "TRANSFER":
        movement_type, from_location, to_location = "TRANSFER", original.get("toLocation"), original.get("fromLocation")
    else:
        movement_type, from_location, to_location = "ADJUST", original.get("toLocation"), original.get("fromLocation")
    reversal_payload = MovementPayload(
        itemId=original["itemId"],
        type=movement_type,
        quantity=original["quantity"],
        serialNumber=original.get("serialNumber"),
        fromLocation=from_location,
        toLocation=to_location,
        referenceType="REVERSAL",
        referenceId=original["id"],
        notes=clean_text(payload.reason) or f"Reversal of Inventory movement {original['id']}",
    )
    movement = create_movement(reversal_payload, posting_key, admin)
    movement["reversalOfId"] = original["id"]
    return movement


@router.get("/locations")
def list_locations(includeInactive: bool = False, admin=Depends(require_admin)):
    seed_inventory_data()
    if inventory_store.postgres_enabled:
        return inventory_store.list_locations(include_inactive=includeInactive)
    return [row for row in locations if includeInactive or row.get("active")]


@router.post("/locations")
def create_location(payload: LocationPayload, admin=Depends(require_admin)):
    data = payload.model_dump(exclude_unset=True)
    if inventory_store.postgres_enabled:
        location = inventory_store.create_location(data)
    else:
        code = normalize_upper(data.get("code"))
        name = clean_text(data.get("name"))
        location_type = normalize_upper(data.get("type") or "STOCKROOM")
        if not code or not name:
            raise HTTPException(status_code=400, detail="Location code and name are required")
        if location_type not in LOCATION_TYPES:
            raise HTTPException(status_code=400, detail="Invalid inventory location type")
        if any(row["code"].lower() == code.lower() for row in locations):
            raise HTTPException(status_code=409, detail="Location code already exists")
        timestamp = now_iso()
        location = {"id": str(uuid4()), "createdAt": timestamp, "updatedAt": timestamp, "archivedAt": None, "active": True, **data, "code": code, "name": name, "type": location_type}
        locations.append(location)
    add_audit("inventory_location_created", "InventoryLocation", location["id"], {"code": location["code"]}, admin["username"])
    return location


@router.patch("/locations/{location_id}")
def update_location(location_id: str, payload: LocationPayload, admin=Depends(require_admin)):
    data = payload.model_dump(exclude_unset=True)
    if inventory_store.postgres_enabled:
        location = inventory_store.update_location(location_id, data)
    else:
        location = find_row(locations, location_id, "Inventory location")
        location.update(data)
        location["updatedAt"] = now_iso()
    add_audit("inventory_location_updated", "InventoryLocation", location["id"], {"code": location["code"]}, admin["username"])
    return location


@router.delete("/locations/{location_id}")
def delete_location(location_id: str, admin=Depends(require_admin)):
    if inventory_store.postgres_enabled:
        result = inventory_store.archive_location(location_id)
    else:
        location = find_row(locations, location_id, "Inventory location")
        location["active"] = False
        location["archivedAt"] = now_iso()
        result = {"status": "ok"}
    add_audit("inventory_location_archived", "InventoryLocation", location_id, {}, admin["username"])
    return result


@router.get("/balances")
def list_balances(itemId: str = "", locationId: str = "", admin=Depends(require_admin)):
    if inventory_store.postgres_enabled:
        return inventory_store.list_balances(item_id=itemId, location_id=locationId)
    rows = []
    for item in visible_items():
        if itemId and item["id"] != itemId:
            continue
        location = next((row for row in locations if row["name"] == item["location"]), locations[0] if locations else None)
        if not location or (locationId and location["id"] != locationId):
            continue
        rows.append({"itemId": item["id"], "item": {"id": item["id"], "sku": item["sku"], "name": item["name"]}, "locationId": location["id"], "location": location, "quantity": item["quantityOnHand"], "version": 0, "updatedAt": item["updatedAt"]})
    return rows


@router.get("/assignments")
def list_assignments(search: str = "", itemId: str = "", status: str = "", admin=Depends(require_admin)):
    seed_inventory_data()
    source_rows = inventory_store.list_assignments() if inventory_store.postgres_enabled else visible_assignments()
    rows = filter_child_rows(source_rows, search=search, itemId=itemId, status=status)
    return sorted(rows, key=lambda row: row["createdAt"], reverse=True)


@router.post("/assignments")
def create_assignment(payload: AssignmentPayload, admin=Depends(require_admin)):
    if inventory_store.postgres_enabled:
        item = inventory_store.get_item(clean_text(payload.itemId))
        record = normalize_assignment_payload(payload, item_override=item, available_quantity_override=item["availableQuantity"])
        assignment = inventory_store.save_assignment(record)
        add_audit("inventory_assignment_created", "InventoryAssignment", assignment["id"], {"itemId": assignment["itemId"]}, admin["username"])
        return assignment
    record = normalize_assignment_payload(payload)
    timestamp = now_iso()
    assignment = {"id": str(uuid4()), "createdAt": timestamp, "updatedAt": timestamp, "deletedAt": None, **record}
    assignments.append(assignment)
    add_audit("inventory_assignment_created", "InventoryAssignment", assignment["id"], {"itemId": assignment["itemId"]}, admin["username"])
    return assignment


@router.patch("/assignments/{assignment_id}")
def update_assignment(assignment_id: str, payload: AssignmentPayload, admin=Depends(require_admin)):
    if inventory_store.postgres_enabled:
        current = inventory_store.get_assignment(assignment_id)
        item_id = clean_text(payload.itemId) or current["itemId"]
        item = inventory_store.get_item(item_id)
        record = normalize_assignment_payload(
            payload,
            current,
            item_override=item,
            available_quantity_override=item["availableQuantity"],
        )
        assignment = inventory_store.save_assignment({**record, "id": assignment_id, "createdAt": current["createdAt"]})
        add_audit("inventory_assignment_updated", "InventoryAssignment", assignment["id"], {"itemId": assignment["itemId"]}, admin["username"])
        return assignment
    current = find_assignment(assignment_id)
    record = normalize_assignment_payload(payload, current)
    current.update(record)
    current["updatedAt"] = now_iso()
    add_audit("inventory_assignment_updated", "InventoryAssignment", current["id"], {"itemId": current["itemId"]}, admin["username"])
    return current


@router.delete("/assignments/{assignment_id}")
def delete_assignment(assignment_id: str, admin=Depends(require_admin)):
    if inventory_store.postgres_enabled:
        current = inventory_store.get_assignment(assignment_id)
        result = inventory_store.return_assignment(assignment_id)
        add_audit("inventory_assignment_returned", "InventoryAssignment", assignment_id, {"itemId": current["itemId"]}, admin["username"])
        return result
    current = find_assignment(assignment_id)
    current["status"] = "RETURNED"
    current["returnedDate"] = today_iso()
    current["deletedAt"] = now_iso()
    current["updatedAt"] = current["deletedAt"]
    add_audit("inventory_assignment_deleted", "InventoryAssignment", current["id"], {"itemId": current["itemId"]}, admin["username"])
    return {"status": "ok"}
