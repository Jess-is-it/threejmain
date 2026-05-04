from datetime import datetime, timezone
from typing import Any, Callable
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field


router = APIRouter(prefix="/api/account-admin", tags=["account-admin"])

accounts: list[dict[str, Any]] = []

_current_admin: Callable[[str | None], dict[str, Any]] | None = None
_audit_logger: Callable[[str, str, str, dict[str, Any] | None, str], None] | None = None
_initial_admin_provider: Callable[[], dict[str, Any]] | None = None

ACCOUNT_STATUSES = ["ACTIVE", "INACTIVE"]


class AccountPayload(BaseModel):
    username: str | None = Field(default=None, min_length=3, max_length=40)
    password: str | None = Field(default=None, min_length=8, max_length=128)
    fullName: str | None = Field(default=None, min_length=1, max_length=120)
    email: str | None = Field(default=None, max_length=160)
    phone: str | None = Field(default=None, max_length=40)
    status: str | None = None
    notes: str | None = Field(default=None, max_length=500)


def configure_account_admin(
    current_admin: Callable[[str | None], dict[str, Any]],
    audit_logger: Callable[[str, str, str, dict[str, Any] | None, str], None],
    initial_admin_provider: Callable[[], dict[str, Any]] | None = None,
) -> None:
    global _current_admin, _audit_logger, _initial_admin_provider
    _current_admin = current_admin
    _audit_logger = audit_logger
    _initial_admin_provider = initial_admin_provider


def require_admin(authorization: str | None = Header(default=None)):
    if _current_admin is None:
        raise HTTPException(status_code=500, detail="Account Admin module is not configured")
    return _current_admin(authorization)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def add_audit(action: str, target_type: str, target_id: str, details: dict[str, Any] | None, actor: str) -> None:
    if _audit_logger is not None:
        _audit_logger(action, target_type, target_id, details, actor)


def normalize_status(value: Any) -> str:
    status = str(value or "ACTIVE").strip().upper()
    if status not in ACCOUNT_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid account status")
    return status


def normalize_username(value: Any) -> str:
    username = str(value or "").strip().lower()
    if len(username) < 3:
        raise HTTPException(status_code=400, detail="Username must be at least 3 characters")
    return username


def public_account(account: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in account.items() if key != "password"}


def visible_accounts() -> list[dict[str, Any]]:
    return [account for account in accounts if not account.get("deletedAt")]


def find_account(account_id: str) -> dict[str, Any]:
    for account in accounts:
        if account["id"] == account_id and not account.get("deletedAt"):
            return account
    raise HTTPException(status_code=404, detail="Account not found")


def username_taken(username: str, account_id: str | None = None) -> bool:
    return any(account["username"] == username and account["id"] != account_id and not account.get("deletedAt") for account in accounts)


def seed_account_admin_data() -> None:
    if accounts:
        return
    source = _initial_admin_provider() if _initial_admin_provider is not None else {}
    timestamp = now_iso()
    accounts.append(
        {
            "id": source.get("id") or "admin-1",
            "username": normalize_username(source.get("username") or "admin"),
            "password": source.get("password") or "admin123",
            "fullName": source.get("full_name") or source.get("fullName") or "System Administrator",
            "email": source.get("email") or "admin@example.local",
            "phone": source.get("phone") or "",
            "status": normalize_status(source.get("status") or "ACTIVE"),
            "notes": "Seeded local administrator account.",
            "lastLoginAt": source.get("lastLoginAt"),
            "createdAt": source.get("created_at") or source.get("createdAt") or timestamp,
            "updatedAt": source.get("updated_at") or source.get("updatedAt") or timestamp,
            "deactivatedAt": None,
            "deletedAt": None,
        }
    )


def get_account_for_auth(account_id: str) -> dict[str, Any] | None:
    seed_account_admin_data()
    for account in visible_accounts():
        if account["id"] == account_id:
            return account
    return None


def authenticate_account(username: str, password: str) -> dict[str, Any] | None:
    seed_account_admin_data()
    normalized = normalize_username(username)
    for account in visible_accounts():
        if account["username"] == normalized and account["password"] == password:
            if account["status"] != "ACTIVE":
                raise HTTPException(status_code=403, detail="Account is inactive")
            account["lastLoginAt"] = now_iso()
            account["updatedAt"] = account["lastLoginAt"]
            return account
    return None


def account_admin_metrics() -> dict[str, int]:
    seed_account_admin_data()
    rows = visible_accounts()
    return {
        "accounts": len(rows),
        "active": sum(1 for account in rows if account["status"] == "ACTIVE"),
        "inactive": sum(1 for account in rows if account["status"] == "INACTIVE"),
    }


def normalize_payload(payload: AccountPayload, current: dict[str, Any] | None = None, creating: bool = False) -> dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    record = dict(current or {})
    record.update({key: value for key, value in data.items() if value is not None})
    required = ["username", "fullName"]
    if creating:
        required.append("password")
    missing = [field for field in required if not str(record.get(field) or "").strip()]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required account fields: {', '.join(missing)}")
    record["username"] = normalize_username(record.get("username"))
    record["fullName"] = str(record.get("fullName") or "").strip()
    record["email"] = str(record.get("email") or "").strip()
    record["phone"] = str(record.get("phone") or "").strip()
    record["notes"] = str(record.get("notes") or "").strip()
    record["status"] = normalize_status(record.get("status"))
    if record.get("password") is not None:
        record["password"] = str(record["password"])
        if len(record["password"]) < 8:
            raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    return record


def filter_accounts(search: str = "", status: str = "") -> list[dict[str, Any]]:
    seed_account_admin_data()
    rows = visible_accounts()
    if status:
        rows = [account for account in rows if account["status"] == normalize_status(status)]
    if search:
        needle = search.strip().lower()
        rows = [
            account
            for account in rows
            if needle in account["username"]
            or needle in account.get("fullName", "").lower()
            or needle in account.get("email", "").lower()
            or needle in account.get("phone", "").lower()
        ]
    return sorted(rows, key=lambda account: account["createdAt"], reverse=True)


@router.get("/meta")
def account_admin_meta(admin=Depends(require_admin)):
    return {"accountStatuses": ACCOUNT_STATUSES, "permissionsDeferred": True}


@router.get("/overview")
def account_admin_overview(admin=Depends(require_admin)):
    rows = filter_accounts()
    return {
        "metrics": account_admin_metrics(),
        "recentAccounts": [public_account(account) for account in rows[:5]],
        "inactiveAccounts": [public_account(account) for account in rows if account["status"] == "INACTIVE"][:5],
        "notes": [
            "Roles and permissions are intentionally deferred for a later Account Admin phase.",
            "The first shell stores accounts in memory until shared PostgreSQL persistence is added.",
        ],
    }


@router.get("/accounts")
def list_accounts(
    search: str = "",
    status: str = Query(default=""),
    admin=Depends(require_admin),
):
    return [public_account(account) for account in filter_accounts(search, status)]


@router.post("/accounts")
def create_account(payload: AccountPayload, admin=Depends(require_admin)):
    seed_account_admin_data()
    record = normalize_payload(payload, creating=True)
    if username_taken(record["username"]):
        raise HTTPException(status_code=400, detail="Username is already in use")
    timestamp = now_iso()
    account = {
        "id": str(uuid4()),
        "lastLoginAt": None,
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "deactivatedAt": timestamp if record["status"] == "INACTIVE" else None,
        "deletedAt": None,
        **record,
    }
    accounts.append(account)
    add_audit("account_admin_account_created", "AdminAccount", account["id"], {"username": account["username"]}, admin["username"])
    return public_account(account)


@router.patch("/accounts/{account_id}")
def update_account(account_id: str, payload: AccountPayload, admin=Depends(require_admin)):
    current = find_account(account_id)
    record = normalize_payload(payload, current=current)
    if username_taken(record["username"], account_id):
        raise HTTPException(status_code=400, detail="Username is already in use")
    previous_status = current["status"]
    current.update(record)
    current["updatedAt"] = now_iso()
    if previous_status != current["status"]:
        current["deactivatedAt"] = current["updatedAt"] if current["status"] == "INACTIVE" else None
    add_audit("account_admin_account_updated", "AdminAccount", current["id"], {"username": current["username"]}, admin["username"])
    return public_account(current)


@router.post("/accounts/{account_id}/activate")
def activate_account(account_id: str, admin=Depends(require_admin)):
    current = find_account(account_id)
    current["status"] = "ACTIVE"
    current["deactivatedAt"] = None
    current["updatedAt"] = now_iso()
    add_audit("account_admin_account_activated", "AdminAccount", current["id"], {"username": current["username"]}, admin["username"])
    return public_account(current)


@router.post("/accounts/{account_id}/deactivate")
def deactivate_account(account_id: str, admin=Depends(require_admin)):
    current = find_account(account_id)
    if current["id"] == admin.get("id"):
        raise HTTPException(status_code=400, detail="You cannot deactivate your own account")
    current["status"] = "INACTIVE"
    current["deactivatedAt"] = now_iso()
    current["updatedAt"] = current["deactivatedAt"]
    add_audit("account_admin_account_deactivated", "AdminAccount", current["id"], {"username": current["username"]}, admin["username"])
    return public_account(current)


@router.delete("/accounts/{account_id}")
def delete_account(account_id: str, admin=Depends(require_admin)):
    current = find_account(account_id)
    if current["id"] == admin.get("id"):
        raise HTTPException(status_code=400, detail="You cannot archive your own account")
    current["deletedAt"] = now_iso()
    current["updatedAt"] = current["deletedAt"]
    add_audit("account_admin_account_archived", "AdminAccount", current["id"], {"username": current["username"]}, admin["username"])
    return {"status": "ok"}
