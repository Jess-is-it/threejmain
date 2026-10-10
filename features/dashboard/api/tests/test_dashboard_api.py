import importlib
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI, HTTPException


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
dashboard_module = importlib.import_module("dashboard.router")


class DashboardApiTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.modules = [
            {"slug": "billing", "metrics": {"monthly_recurring_revenue": 4200}},
            {"slug": "ticketing", "metrics": {"open_tickets": 3}},
            {"slug": "inventory", "metrics": {"low_stock": 2}},
        ]
        self.calls = []

        def current_admin(authorization):
            if authorization != "Bearer test-session":
                raise HTTPException(status_code=401, detail="Authentication required")
            self.calls.append("authenticate")
            return {"username": "test-owner"}

        self.addCleanup(dashboard_module.configure_dashboard,
                        dashboard_module._current_admin,
                        dashboard_module._seed_module_data,
                        dashboard_module._sync_module_metrics,
                        dashboard_module._modules,
                        dashboard_module._customer_metrics)
        dashboard_module.configure_dashboard(
            current_admin,
            lambda: self.calls.append("seed"),
            lambda: self.calls.append("sync"),
            self.modules,
            lambda: {"customers": 7},
        )
        self.app = FastAPI()
        self.app.include_router(dashboard_module.router)

    async def get_dashboard(self, authorization="Bearer test-session"):
        messages = []

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            messages.append(message)

        await self.app({
            "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
            "method": "GET", "scheme": "http", "path": "/api/dashboard",
            "raw_path": b"/api/dashboard", "query_string": b"", "root_path": "",
            "headers": [(b"authorization", authorization.encode())] if authorization else [],
            "client": ("127.0.0.1", 12345), "server": ("test", 80),
        }, receive, send)
        status = next(message["status"] for message in messages if message["type"] == "http.response.start")
        body = b"".join(message.get("body", b"") for message in messages if message["type"] == "http.response.body")
        return status, json.loads(body)

    async def test_preserved_contract_and_metric_refresh_order(self):
        status, payload = await self.get_dashboard()
        self.assertEqual(200, status)
        self.assertEqual(["authenticate", "seed", "sync"], self.calls)
        self.assertEqual({"summary", "modules", "module_counts", "alerts"}, set(payload))
        self.assertEqual({
            "modules": 3, "customers": 7, "open_tickets": 3,
            "monthly_revenue": 4200, "inventory_alerts": 2,
        }, payload["summary"])
        self.assertEqual(self.modules, payload["modules"])
        self.assertEqual({module["slug"]: module["metrics"] for module in self.modules}, payload["module_counts"])
        self.assertEqual([
            {"level": "info", "message": "Customer Profiling is loaded from the features/customer-profiling module folder."},
            {"level": "info", "message": "Business modules, System Settings, and Logs are loaded from features module folders."},
            {"level": "warning", "message": "Default admin password should be changed before deployment."},
        ], payload["alerts"])

    async def test_missing_optional_sources_default_to_zero(self):
        self.modules.clear()
        status, payload = await self.get_dashboard()
        self.assertEqual(200, status)
        self.assertEqual({
            "modules": 0, "customers": 7, "open_tickets": 0,
            "monthly_revenue": 0, "inventory_alerts": 0,
        }, payload["summary"])

    async def test_shared_registry_changes_are_visible(self):
        self.modules.append({"slug": "service", "metrics": {"active_accounts": 5}})
        status, payload = await self.get_dashboard()
        self.assertEqual(200, status)
        self.assertEqual(4, payload["summary"]["modules"])
        self.assertEqual({"active_accounts": 5}, payload["module_counts"]["service"])

    async def test_unauthorized_requests_do_not_load_metrics(self):
        for authorization in ("", "Bearer expired-session"):
            status, payload = await self.get_dashboard(authorization)
            self.assertEqual(401, status)
            self.assertEqual("Authentication required", payload["detail"])
        self.assertEqual([], self.calls)

    async def test_unconfigured_module_reports_error(self):
        with patch.object(dashboard_module, "_current_admin", None):
            status, payload = await self.get_dashboard()
            self.assertEqual(500, status)
            self.assertEqual("Dashboard module is not configured", payload["detail"])
        with patch.object(dashboard_module, "_modules", None):
            status, payload = await self.get_dashboard()
            self.assertEqual(500, status)
            self.assertEqual("Dashboard module is not configured", payload["detail"])


if __name__ == "__main__":
    unittest.main()
