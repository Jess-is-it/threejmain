import importlib
import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
system_settings = importlib.import_module("system_settings.router")


class DashboardPermissionTests(unittest.TestCase):
    def test_new_catalog_permission_does_not_grant_existing_finance_role(self):
        access = system_settings.normalize_access_store(
            {
                "roles": [
                    {
                        "id": "role-finance-officer",
                        "name": "finance_officer",
                        "permissionCodes": ["billing.view", "collector.portal.view"],
                    }
                ]
            }
        )
        catalog = {permission["code"]: permission for permission in access["permissions"]}
        finance_role = next(role for role in access["roles"] if role["name"] == "finance_officer")
        owner_role = next(role for role in access["roles"] if role["name"] == "owner")

        self.assertEqual("Dashboard", catalog["dashboard.view"]["category"])
        self.assertNotIn("dashboard.view", finance_role["permissionCodes"])
        self.assertIn("dashboard.view", owner_role["permissionCodes"])


if __name__ == "__main__":
    unittest.main()
