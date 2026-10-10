from typing import Any, Callable

from fastapi import APIRouter, Depends, Header, HTTPException


router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

_current_admin: Callable | None = None
_seed_module_data: Callable | None = None
_sync_module_metrics: Callable | None = None
_customer_metrics: Callable | None = None
_modules: list[dict[str, Any]] | None = None


def configure_dashboard(
    current_admin: Callable,
    seed_module_data: Callable,
    sync_module_metrics: Callable,
    modules: list[dict[str, Any]],
    customer_metrics: Callable,
) -> None:
    global _current_admin, _seed_module_data, _sync_module_metrics, _modules, _customer_metrics
    _current_admin = current_admin
    _seed_module_data = seed_module_data
    _sync_module_metrics = sync_module_metrics
    _modules = modules
    _customer_metrics = customer_metrics


def require_admin(authorization: str | None = Header(default=None)):
    if _current_admin is None:
        raise HTTPException(status_code=500, detail="Dashboard module is not configured")
    return _current_admin(authorization)


@router.get("")
def dashboard(admin=Depends(require_admin)):
    if any(dependency is None for dependency in (
        _seed_module_data, _sync_module_metrics, _modules, _customer_metrics,
    )):
        raise HTTPException(status_code=500, detail="Dashboard module is not configured")
    _seed_module_data()
    _sync_module_metrics()
    module_counts = {module["slug"]: module["metrics"] for module in _modules}
    billing_summary = module_counts.get("billing", {})
    ticketing_summary = module_counts.get("ticketing", {})
    inventory_summary = module_counts.get("inventory", {})
    return {
        "summary": {
            "modules": len(_modules),
            "customers": _customer_metrics()["customers"],
            "open_tickets": ticketing_summary.get("open_tickets", 0),
            "monthly_revenue": billing_summary.get("monthly_recurring_revenue", 0),
            "inventory_alerts": inventory_summary.get("low_stock", 0),
        },
        "modules": _modules,
        "module_counts": module_counts,
        "alerts": [
            {"level": "info", "message": "Customer Profiling is loaded from the features/customer-profiling module folder."},
            {"level": "info", "message": "Business modules, System Settings, and Logs are loaded from features module folders."},
            {"level": "warning", "message": "Default admin password should be changed before deployment."},
        ],
    }
