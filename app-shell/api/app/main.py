import os
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import psutil
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


for parent in Path(__file__).resolve().parents:
    local_module_api_roots = [
        parent / "customer-profiling" / "api",
        parent / "billing" / "api",
        parent / "point-of-sale" / "api",
    ]
    if any(module_api_root.exists() for module_api_root in local_module_api_roots):
        for module_api_root in local_module_api_roots:
            if module_api_root.exists() and str(module_api_root) not in sys.path:
                sys.path.insert(0, str(module_api_root))
        break

from customer_profiling import configure_customer_profiling, customer_metrics, router as customer_profiling_router, seed_customer_data
from customer_profiling.router import customer_summary, find_customer, visible_customers
from billing import billing_metrics, configure_billing, router as billing_router, seed_billing_data
from point_of_sale import configure_point_of_sale, point_of_sale_metrics, router as point_of_sale_router, seed_point_of_sale_data


APP_STARTED_AT = time.time()

DEFAULT_ADMIN_USERNAME = os.getenv("DEFAULT_ADMIN_USERNAME", "admin")
DEFAULT_ADMIN_PASSWORD = os.getenv("DEFAULT_ADMIN_PASSWORD", "admin123")

admin_user = {
    "id": "admin-1",
    "username": DEFAULT_ADMIN_USERNAME,
    "password": DEFAULT_ADMIN_PASSWORD,
    "full_name": os.getenv("DEFAULT_ADMIN_NAME", "System Administrator"),
    "email": os.getenv("DEFAULT_ADMIN_EMAIL", "admin@example.local"),
    "role": "owner",
    "status": "active",
    "created_at": datetime.now(timezone.utc).isoformat(),
}

active_tokens: dict[str, str] = {}
audit_logs: list[dict[str, Any]] = []

settings = {
    "branding": {
        "display_name": "3J ISP Management",
        "portal_subtitle": "Small ISP operations dashboard",
        "accent_color": "#206bc4",
        "company_logo_url": None,
        "browser_logo_url": None,
    },
    "business": {
        "name": "3J Internet Services",
        "support_phone": "",
        "support_email": "",
        "billing_currency": "PHP",
    },
    "deployment": {
        "environment": os.getenv("APP_ENV", "local"),
        "main_repo": "/home/threejmain",
        "worktrees": "/home/worktrees",
    },
}

modules = [
    {
        "slug": "customer-profiling",
        "name": "Customer Profiling",
        "folder": "customer-profiling",
        "status": "functional-shell",
        "description": "Customer records, account identity, service plans, addresses, contacts, bulk upload workflow, and account lifecycle.",
        "metrics": {"customers": 0, "active": 0, "pending": 0},
    },
    {
        "slug": "billing",
        "name": "Billing",
        "folder": "billing",
        "status": "functional-shell",
        "description": "ISP subscriptions, invoices, payments, adjustments, balances, billing cycles, and collections.",
        "metrics": {"open_invoices": 0, "overdue": 0, "collections": 0, "monthly_recurring_revenue": 0},
    },
    {
        "slug": "point-of-sale",
        "name": "Point of Sale",
        "folder": "point-of-sale",
        "status": "functional-shell",
        "description": "Counter sales, receipts, payment capture, daily cashier sessions, and sales reports.",
        "metrics": {"today_sales": 0, "transactions": 0, "open_shift": 0, "active_items": 0, "low_stock": 0},
    },
    {
        "slug": "inventory",
        "name": "Inventory",
        "folder": "inventory",
        "status": "planned",
        "description": "Routers, ONUs/CPEs, cables, installation materials, stock movements, and reorder alerts.",
        "metrics": {"items": 0, "low_stock": 0, "assigned_assets": 0},
    },
    {
        "slug": "account-admin",
        "name": "Account Admin",
        "folder": "account-admin",
        "status": "planned",
        "description": "Admin users, staff access, roles, permissions, account security, and audit controls.",
        "metrics": {"admins": 1, "roles": 1, "locked_accounts": 0},
    },
    {
        "slug": "customer-service-management",
        "name": "Customer Service Management",
        "folder": "customer-service-management",
        "status": "planned",
        "description": "Customer interactions, service requests, follow-ups, callbacks, and care workflows.",
        "metrics": {"open_requests": 0, "callbacks_due": 0, "sla_risks": 0},
    },
    {
        "slug": "ticketing",
        "name": "Ticketing",
        "folder": "ticketing",
        "status": "planned",
        "description": "Trouble tickets, field jobs, outage tracking, dispatch, notes, and resolution history.",
        "metrics": {"open_tickets": 0, "urgent": 0, "field_jobs": 0},
    },
]


class LoginPayload(BaseModel):
    username: str
    password: str


class ProfilePayload(BaseModel):
    full_name: str | None = None
    email: str | None = None


class PasswordPayload(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)
    confirm_password: str = Field(min_length=8)


class SettingsPayload(BaseModel):
    branding: dict[str, Any] | None = None
    business: dict[str, Any] | None = None
    deployment: dict[str, Any] | None = None


app = FastAPI(title="3J ISP Management API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ALLOW_ORIGINS", "http://localhost:8180,http://127.0.0.1:8180").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def add_audit(
    action: str,
    target_type: str,
    target_id: str,
    details: dict[str, Any] | None = None,
    actor: str = "system",
):
    audit_logs.insert(
        0,
        {
            "id": str(uuid4()),
            "actor": actor,
            "action": action,
            "target_type": target_type,
            "target_id": target_id,
            "details": details or {},
            "created_at": now_iso(),
        },
    )
    del audit_logs[100:]


def current_admin(authorization: str | None = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    token = authorization.removeprefix("Bearer ").strip()
    if active_tokens.get(token) != admin_user["id"]:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return admin_user


def public_user(user: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in user.items() if key != "password"}


def sync_module_metrics() -> None:
    for module in modules:
        if module["slug"] == "customer-profiling":
            module["status"] = "functional-shell"
            module["metrics"] = customer_metrics()
        if module["slug"] == "billing":
            module["status"] = "functional-shell"
            module["metrics"] = billing_metrics()
        if module["slug"] == "point-of-sale":
            module["status"] = "functional-shell"
            module["metrics"] = point_of_sale_metrics()


def billing_customer_search(search: str = "") -> list[dict[str, Any]]:
    seed_customer_data()
    rows = visible_customers()
    if search:
        needle = search.strip().lower()
        rows = [
            customer
            for customer in rows
            if needle in customer_summary(customer).get("accountNumber", "").lower()
            or needle in " ".join(
                str(customer.get(field) or "")
                for field in ["firstName", "middleName", "lastName", "contactNumber", "email", "facebookAccountName"]
            ).lower()
        ]
    return [customer_summary(customer) for customer in rows]


def billing_customer_resolver(customer_id: str) -> dict[str, Any]:
    seed_customer_data()
    return customer_summary(find_customer(customer_id))


def port_registry() -> list[dict[str, Any]]:
    return [
        {
            "port": 8180,
            "protocol": "tcp",
            "scope": "host",
            "owner": "threejmain",
            "service": "ISP management web/admin proxy",
            "status": "reserved",
            "notes": "Primary browser entry point for this app shell.",
        },
        {
            "port": 8100,
            "protocol": "tcp",
            "scope": "host/internal",
            "owner": "threejmain",
            "service": "ISP management FastAPI API",
            "status": "reserved",
            "notes": "Used directly in development and by the web proxy in Docker.",
        },
        {
            "port": 5432,
            "protocol": "tcp",
            "scope": "container-only",
            "owner": "threejmain",
            "service": "PostgreSQL",
            "status": "internal",
            "notes": "Do not expose on the host by default to avoid collisions.",
        },
        {
            "port": 8080,
            "protocol": "tcp",
            "scope": "host",
            "owner": "3JCentralPisowifi",
            "service": "Existing staging admin portal",
            "status": "in-use",
            "notes": "Reserved by /home/threejpisowifi. Do not use for threejmain.",
        },
        {
            "port": 80,
            "protocol": "tcp",
            "scope": "host",
            "owner": "3JCentralPisowifi",
            "service": "Existing production web",
            "status": "reserved",
            "notes": "Avoid using for local threejmain development.",
        },
        {
            "port": 1812,
            "protocol": "udp",
            "scope": "host",
            "owner": "3JCentralPisowifi",
            "service": "Production RADIUS authentication",
            "status": "reserved",
            "notes": "Do not reuse for the ISP management web app.",
        },
        {
            "port": 1813,
            "protocol": "udp",
            "scope": "host",
            "owner": "3JCentralPisowifi",
            "service": "Production RADIUS accounting",
            "status": "reserved",
            "notes": "Do not reuse for the ISP management web app.",
        },
        {
            "port": 11812,
            "protocol": "udp",
            "scope": "host",
            "owner": "3JCentralPisowifi",
            "service": "Staging RADIUS authentication",
            "status": "reserved",
            "notes": "Existing staging RADIUS port.",
        },
        {
            "port": 11813,
            "protocol": "udp",
            "scope": "host",
            "owner": "3JCentralPisowifi",
            "service": "Staging RADIUS accounting",
            "status": "reserved",
            "notes": "Existing staging RADIUS port.",
        },
    ]


configure_customer_profiling(current_admin, add_audit)
configure_billing(current_admin, add_audit, billing_customer_resolver, billing_customer_search, seed_customer_data)
configure_point_of_sale(current_admin, add_audit, billing_customer_resolver, billing_customer_search, seed_customer_data)
app.include_router(customer_profiling_router)
app.include_router(billing_router)
app.include_router(point_of_sale_router)


@app.on_event("startup")
def seed_logs():
    seed_customer_data()
    seed_billing_data()
    seed_point_of_sale_data()
    sync_module_metrics()
    if not audit_logs:
        add_audit("system_started", "app", "app-shell", {"message": "ISP management shell started"})


@app.get("/health")
def health():
    return {"status": "ok", "service": "3J ISP Management API", "time": now_iso()}


@app.post("/api/auth/login")
def login(payload: LoginPayload, request: Request):
    if payload.username != admin_user["username"] or payload.password != admin_user["password"]:
        add_audit("login_failed", "admin", payload.username, {"client": request.client.host if request.client else None})
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token = str(uuid4())
    active_tokens[token] = admin_user["id"]
    add_audit("login_success", "admin", admin_user["id"], {"username": admin_user["username"]}, admin_user["username"])
    return {"access_token": token, "token_type": "bearer", "user": public_user(admin_user)}


@app.post("/api/auth/logout")
def logout(authorization: str | None = Header(default=None)):
    if authorization and authorization.startswith("Bearer "):
        active_tokens.pop(authorization.removeprefix("Bearer ").strip(), None)
    return {"status": "ok"}


@app.get("/api/public/branding")
def public_branding():
    return settings["branding"]


@app.get("/api/me")
def get_me(admin=Depends(current_admin)):
    return public_user(admin)


@app.patch("/api/me")
def update_me(payload: ProfilePayload, admin=Depends(current_admin)):
    if payload.full_name is not None:
        admin["full_name"] = payload.full_name
    if payload.email is not None:
        admin["email"] = payload.email
    add_audit("profile_updated", "admin", admin["id"], {"username": admin["username"]}, admin["username"])
    return public_user(admin)


@app.post("/api/me/change-password")
def change_password(payload: PasswordPayload, admin=Depends(current_admin)):
    if payload.current_password != admin["password"]:
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if payload.new_password != payload.confirm_password:
        raise HTTPException(status_code=400, detail="Password confirmation does not match")
    admin["password"] = payload.new_password
    add_audit("password_changed", "admin", admin["id"], {"username": admin["username"]}, admin["username"])
    return {"status": "ok"}


@app.get("/api/modules")
def list_modules(admin=Depends(current_admin)):
    seed_customer_data()
    seed_billing_data()
    seed_point_of_sale_data()
    sync_module_metrics()
    return modules


@app.get("/api/dashboard")
def dashboard(admin=Depends(current_admin)):
    seed_customer_data()
    seed_billing_data()
    seed_point_of_sale_data()
    sync_module_metrics()
    module_counts = {module["slug"]: module["metrics"] for module in modules}
    billing_counts = billing_metrics()
    pos_counts = point_of_sale_metrics()
    return {
        "summary": {
            "modules": len(modules),
            "customers": customer_metrics()["customers"],
            "open_tickets": 0,
            "monthly_revenue": billing_counts["monthly_recurring_revenue"],
            "inventory_alerts": pos_counts["low_stock"],
        },
        "modules": modules,
        "module_counts": module_counts,
        "alerts": [
            {"level": "info", "message": "Customer Profiling is loaded from the customer-profiling module folder."},
            {"level": "info", "message": "Billing is loaded from the billing module folder with in-memory first-shell data."},
            {"level": "info", "message": "Point of Sale is loaded with local item, session, sale, and payment CRUD placeholders."},
            {"level": "warning", "message": "Default admin password should be changed before deployment."},
        ],
    }


@app.get("/api/system/resources")
def resources(admin=Depends(current_admin)):
    disk = shutil.disk_usage("/")
    return {
        "cpu_pct": psutil.cpu_percent(interval=0.05),
        "ram_pressure_pct": psutil.virtual_memory().percent,
        "ram_used_incl_cache_pct": psutil.virtual_memory().percent,
        "disk_pct": round((disk.used / disk.total) * 100, 1),
        "uptime_seconds": int(time.time() - psutil.boot_time()),
        "app_uptime_seconds": int(time.time() - APP_STARTED_AT),
    }


@app.get("/api/system/settings")
def get_settings(admin=Depends(current_admin)):
    return settings


@app.patch("/api/system/settings")
def update_settings(payload: SettingsPayload, admin=Depends(current_admin)):
    for section in ["branding", "business", "deployment"]:
        value = getattr(payload, section)
        if value is not None:
            settings[section].update(value)
    add_audit("settings_updated", "system", "settings", {"sections": list(payload.model_dump(exclude_none=True).keys())}, admin["username"])
    return settings


@app.get("/api/system/ports")
def ports(admin=Depends(current_admin)):
    return port_registry()


@app.get("/api/audit-logs")
def logs(admin=Depends(current_admin)):
    return audit_logs
