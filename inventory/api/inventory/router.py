from datetime import datetime, timezone
from typing import Any, Callable
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field


router = APIRouter(prefix="/api/inventory", tags=["inventory"])

items: list[dict[str, Any]] = []
movements: list[dict[str, Any]] = []
assignments: list[dict[str, Any]] = []

_current_admin: Callable[[str | None], dict[str, Any]] | None = None
_audit_logger: Callable[[str, str, str, dict[str, Any] | None, str], None] | None = None

ITEM_CATEGORIES = ["ROUTER", "ONU_CPE", "CABLE", "INSTALLATION_MATERIAL", "CONSUMABLE", "TOOL", "OTHER"]
TRACKING_TYPES = ["STOCK", "SERIALIZED"]
ITEM_STATUSES = ["ACTIVE", "INACTIVE", "ARCHIVED"]
MOVEMENT_TYPES = ["RECEIVE", "ISSUE", "ADJUST", "TRANSFER", "RETURN"]
ASSIGNMENT_STATUSES = ["ASSIGNED", "RETURNED", "LOST", "DAMAGED"]


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
    status: str | None = None
    serialNumbers: list[str] | None = None
    notes: str | None = None


class MovementPayload(BaseModel):
    itemId: str | None = None
    type: str | None = None
    quantity: float | None = Field(default=None, gt=0)
    fromLocation: str | None = None
    toLocation: str | None = None
    referenceType: str | None = None
    referenceId: str | None = None
    notes: str | None = None


class AssignmentPayload(BaseModel):
    itemId: str | None = None
    serialNumber: str | None = None
    quantity: float | None = Field(default=None, gt=0)
    assignedToName: str | None = None
    customerId: str | None = None
    serviceId: str | None = None
    ticketId: str | None = None
    location: str | None = None
    status: str | None = None
    assignedDate: str | None = None
    returnedDate: str | None = None
    notes: str | None = None


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


def next_sku(category: str) -> str:
    prefix = {
        "ROUTER": "RTR",
        "ONU_CPE": "ONU",
        "CABLE": "CBL",
        "INSTALLATION_MATERIAL": "MAT",
        "CONSUMABLE": "CON",
        "TOOL": "TOL",
    }.get(category, "INV")
    return f"{prefix}-{len(items) + 1:04d}"


def item_summary(item: dict[str, Any]) -> dict[str, Any]:
    available = number(item["quantityOnHand"] - assigned_quantity(item["id"]))
    return {
        **item,
        "assignedQuantity": assigned_quantity(item["id"]),
        "availableQuantity": max(0, available),
        "stockValue": number(item["quantityOnHand"] * item["unitCost"]),
        "lowStock": item["status"] == "ACTIVE" and item["quantityOnHand"] <= item["reorderPoint"],
    }


def normalize_item_payload(payload: ItemPayload, current: dict[str, Any] | None = None) -> dict[str, Any]:
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
    record["sku"] = clean_text(record.get("sku")) or next_sku(record["category"])
    duplicate = next((item for item in visible_items() if item["sku"].lower() == record["sku"].lower() and item.get("id") != record.get("id")), None)
    if duplicate:
        raise HTTPException(status_code=400, detail="SKU already exists")
    record["unit"] = clean_text(record.get("unit")) or ("unit" if record["trackingType"] == "SERIALIZED" else "pcs")
    record["quantityOnHand"] = number(record.get("quantityOnHand"))
    record["reorderPoint"] = number(record.get("reorderPoint"))
    record["unitCost"] = number(record.get("unitCost"))
    record["location"] = clean_text(record.get("location")) or "Main stockroom"
    record["supplier"] = clean_text(record.get("supplier"))
    record["notes"] = clean_text(record.get("notes"))
    record["serialNumbers"] = [clean_text(value) for value in record.get("serialNumbers", []) if clean_text(value)]
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
        item["quantityOnHand"] = number(item["quantityOnHand"] + delta)
        item["updatedAt"] = timestamp


def normalize_movement_payload(payload: MovementPayload, current: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    record = dict(current or {})
    record.update({key: value for key, value in data.items() if value is not None})
    if not record.get("itemId"):
        raise HTTPException(status_code=400, detail="itemId is required")
    item = find_item(record["itemId"])
    record["item"] = {"id": item["id"], "sku": item["sku"], "name": item["name"], "unit": item["unit"]}
    record["type"] = normalize_upper(record.get("type") or "RECEIVE")
    if record["type"] not in MOVEMENT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid movement type")
    record["quantity"] = number(record.get("quantity"))
    if record["quantity"] <= 0:
        raise HTTPException(status_code=400, detail="Movement quantity must be greater than zero")
    record["fromLocation"] = clean_text(record.get("fromLocation"))
    record["toLocation"] = clean_text(record.get("toLocation")) or item["location"]
    record["referenceType"] = clean_text(record.get("referenceType")) or "MANUAL"
    record["referenceId"] = clean_text(record.get("referenceId"))
    record["notes"] = clean_text(record.get("notes"))
    return record


def normalize_assignment_payload(payload: AssignmentPayload, current: dict[str, Any] | None = None) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    record = dict(current or {})
    record.update({key: value for key, value in data.items() if value is not None})
    if not record.get("itemId"):
        raise HTTPException(status_code=400, detail="itemId is required")
    item = find_item(record["itemId"])
    record["item"] = {"id": item["id"], "sku": item["sku"], "name": item["name"], "unit": item["unit"], "trackingType": item["trackingType"]}
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
    if record["status"] == "ASSIGNED" and record["quantity"] > item_summary(item)["availableQuantity"] + current_quantity:
        raise HTTPException(status_code=400, detail="Not enough available stock for assignment")
    record["assignedToName"] = clean_text(record.get("assignedToName")) or "Unlinked customer placeholder"
    record["customerId"] = clean_text(record.get("customerId"))
    record["serviceId"] = clean_text(record.get("serviceId"))
    record["ticketId"] = clean_text(record.get("ticketId"))
    record["location"] = clean_text(record.get("location")) or item["location"]
    record["assignedDate"] = clean_text(record.get("assignedDate")) or today_iso()
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


def inventory_metrics() -> dict[str, float | int]:
    seed_inventory_data()
    item_rows = [item_summary(item) for item in visible_items()]
    return {
        "items": len(item_rows),
        "active_items": sum(1 for item in item_rows if item["status"] == "ACTIVE"),
        "low_stock": sum(1 for item in item_rows if item["lowStock"]),
        "out_of_stock": sum(1 for item in item_rows if item["quantityOnHand"] <= 0),
        "assigned_assets": sum(1 for assignment in visible_assignments() if assignment["status"] == "ASSIGNED"),
        "stock_value": number(sum(item["stockValue"] for item in item_rows)),
    }


def seed_inventory_data() -> None:
    if items:
        return
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
            "status": "ACTIVE",
            "serialNumbers": ["RTR-W1001", "RTR-W1002"],
            "notes": "Low-stock seed router line.",
        },
    ]
    for row in seed_rows:
        items.append({"id": str(uuid4()), "createdAt": timestamp, "updatedAt": timestamp, "deletedAt": None, **row})


@router.get("/meta")
def inventory_meta(admin=Depends(require_admin)):
    return {
        "itemCategories": ITEM_CATEGORIES,
        "trackingTypes": TRACKING_TYPES,
        "itemStatuses": ITEM_STATUSES,
        "movementTypes": MOVEMENT_TYPES,
        "assignmentStatuses": ASSIGNMENT_STATUSES,
        "integrationPlaceholders": {
            "customerId": "Customer Profiling link placeholder",
            "serviceId": "Customer service assignment link placeholder",
            "ticketId": "Ticketing/field job link placeholder",
            "referenceId": "Billing, POS, Ticketing, or manual document reference placeholder",
        },
    }


@router.get("/overview")
def inventory_overview(admin=Depends(require_admin)):
    seed_inventory_data()
    item_rows = [item_summary(item) for item in visible_items()]
    return {
        "metrics": inventory_metrics(),
        "lowStockItems": [item for item in item_rows if item["lowStock"]][:8],
        "recentMovements": sorted(visible_movements(), key=lambda row: row["createdAt"], reverse=True)[:8],
        "activeAssignments": [assignment for assignment in visible_assignments() if assignment["status"] == "ASSIGNED"][:8],
    }


@router.get("/items")
def list_items(search: str = "", category: str = "", status: str = "", lowStock: bool = False, admin=Depends(require_admin)):
    seed_inventory_data()
    return sorted(filter_items(search, category, status, lowStock), key=lambda row: row["updatedAt"], reverse=True)


@router.post("/items")
def create_item(payload: ItemPayload, admin=Depends(require_admin)):
    record = normalize_item_payload(payload)
    timestamp = now_iso()
    item = {"id": str(uuid4()), "createdAt": timestamp, "updatedAt": timestamp, "deletedAt": None, **record}
    items.append(item)
    add_audit("inventory_item_created", "InventoryItem", item["id"], {"sku": item["sku"]}, admin["username"])
    return item_summary(item)


@router.patch("/items/{item_id}")
def update_item(item_id: str, payload: ItemPayload, admin=Depends(require_admin)):
    current = find_item(item_id)
    record = normalize_item_payload(payload, current)
    current.update(record)
    current["updatedAt"] = now_iso()
    add_audit("inventory_item_updated", "InventoryItem", current["id"], {"sku": current["sku"]}, admin["username"])
    return item_summary(current)


@router.delete("/items/{item_id}")
def delete_item(item_id: str, admin=Depends(require_admin)):
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
    rows = filter_child_rows(visible_movements(), search=search, itemId=itemId, row_type=type)
    return sorted(rows, key=lambda row: row["createdAt"], reverse=True)


@router.post("/movements")
def create_movement(payload: MovementPayload, admin=Depends(require_admin)):
    record = normalize_movement_payload(payload)
    apply_movement_changes(next_record=record)
    timestamp = now_iso()
    movement = {"id": str(uuid4()), "createdAt": timestamp, "updatedAt": timestamp, "deletedAt": None, **record}
    movements.append(movement)
    add_audit("inventory_movement_created", "InventoryMovement", movement["id"], {"itemId": movement["itemId"], "type": movement["type"]}, admin["username"])
    return movement


@router.patch("/movements/{movement_id}")
def update_movement(movement_id: str, payload: MovementPayload, admin=Depends(require_admin)):
    current = find_movement(movement_id)
    record = normalize_movement_payload(payload, current)
    apply_movement_changes(previous=current, next_record=record)
    current.update(record)
    current["updatedAt"] = now_iso()
    add_audit("inventory_movement_updated", "InventoryMovement", current["id"], {"itemId": current["itemId"]}, admin["username"])
    return current


@router.delete("/movements/{movement_id}")
def delete_movement(movement_id: str, admin=Depends(require_admin)):
    current = find_movement(movement_id)
    apply_movement_changes(previous=current)
    current["deletedAt"] = now_iso()
    current["updatedAt"] = current["deletedAt"]
    add_audit("inventory_movement_deleted", "InventoryMovement", current["id"], {"itemId": current["itemId"]}, admin["username"])
    return {"status": "ok"}


@router.get("/assignments")
def list_assignments(search: str = "", itemId: str = "", status: str = "", admin=Depends(require_admin)):
    seed_inventory_data()
    rows = filter_child_rows(visible_assignments(), search=search, itemId=itemId, status=status)
    return sorted(rows, key=lambda row: row["createdAt"], reverse=True)


@router.post("/assignments")
def create_assignment(payload: AssignmentPayload, admin=Depends(require_admin)):
    record = normalize_assignment_payload(payload)
    timestamp = now_iso()
    assignment = {"id": str(uuid4()), "createdAt": timestamp, "updatedAt": timestamp, "deletedAt": None, **record}
    assignments.append(assignment)
    add_audit("inventory_assignment_created", "InventoryAssignment", assignment["id"], {"itemId": assignment["itemId"]}, admin["username"])
    return assignment


@router.patch("/assignments/{assignment_id}")
def update_assignment(assignment_id: str, payload: AssignmentPayload, admin=Depends(require_admin)):
    current = find_assignment(assignment_id)
    record = normalize_assignment_payload(payload, current)
    current.update(record)
    current["updatedAt"] = now_iso()
    add_audit("inventory_assignment_updated", "InventoryAssignment", current["id"], {"itemId": current["itemId"]}, admin["username"])
    return current


@router.delete("/assignments/{assignment_id}")
def delete_assignment(assignment_id: str, admin=Depends(require_admin)):
    current = find_assignment(assignment_id)
    current["status"] = "RETURNED"
    current["returnedDate"] = today_iso()
    current["deletedAt"] = now_iso()
    current["updatedAt"] = current["deletedAt"]
    add_audit("inventory_assignment_deleted", "InventoryAssignment", current["id"], {"itemId": current["itemId"]}, admin["username"])
    return {"status": "ok"}
