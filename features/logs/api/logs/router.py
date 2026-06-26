from typing import Any, Callable

from fastapi import APIRouter, Depends, Header, HTTPException


router = APIRouter(tags=["logs"])

_current_admin: Callable[[str | None], dict[str, Any]] | None = None
_audit_logs: list[dict[str, Any]] | None = None


def configure_logs(
    current_admin: Callable[[str | None], dict[str, Any]],
    audit_logs: list[dict[str, Any]],
) -> None:
    global _current_admin, _audit_logs
    _current_admin = current_admin
    _audit_logs = audit_logs


def require_admin(authorization: str | None = Header(default=None)):
    if _current_admin is None:
        raise HTTPException(status_code=500, detail="Logs module is not configured")
    return _current_admin(authorization)


def audit_log_store() -> list[dict[str, Any]]:
    if _audit_logs is None:
        raise HTTPException(status_code=500, detail="Logs store is not configured")
    return _audit_logs


@router.get("/api/logs")
@router.get("/api/audit-logs")
def logs(admin=Depends(require_admin)):
    return audit_log_store()
