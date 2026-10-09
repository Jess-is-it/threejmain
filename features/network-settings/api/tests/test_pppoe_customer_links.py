import importlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException


FEATURES = Path(__file__).resolve().parents[3]
for module_name in ("network-settings", "customer-profiling", "service"):
    sys.path.insert(0, str(FEATURES / module_name / "api"))

network = importlib.import_module("network_settings.router")
customers = importlib.import_module("customer_profiling.router")
service = importlib.import_module("service.router")


class PppoeCustomerLinkTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.old_path = network.NETWORK_SETTINGS_DATA_PATH
        self.old_loaded = network._data_loaded
        self.old_devices = list(network.network_devices)
        self.old_links = list(network.pppoe_customer_links)
        network.NETWORK_SETTINGS_DATA_PATH = str(Path(self.temp_dir.name) / "network_settings.json")
        network._data_loaded = True
        network.network_devices[:] = [{
            "id": "router-1", "name": "Router A", "deviceType": "MIKROTIK", "accessMethod": "API",
            "managementIp": "192.0.2.10", "apiPort": 8728,
        }]
        network.pppoe_customer_links.clear()
        self.admin = {"username": "operator", "permissions": ["network-settings.edit", "network-settings.view"]}
        self.account = network.pppoe_account_row(
            network.network_devices[0],
            {".id": "*A", "name": "home123", "service": "pppoe", "profile": "20M", "disabled": "false"},
            {"name": "home123", "service": "pppoe", "address": "10.0.0.7"},
        )
        self.customer = {"id": "customer-1", "firstName": "Ada", "lastName": "Lovelace", "accountNumber": "C-001"}
        self.patches = [
            patch.object(network, "fetch_mikrotik_pppoe_accounts", return_value=[self.account]),
            patch.object(customers, "seed_customer_data"),
            patch.object(customers, "find_customer", return_value=self.customer),
            patch.object(service, "seed_service_data"),
            patch.object(service, "visible_accounts", return_value=[{
                "id": "service-1", "customerId": "customer-1", "serviceAccountNumber": "SA-001"
            }]),
        ]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        network.NETWORK_SETTINGS_DATA_PATH = self.old_path
        network._data_loaded = self.old_loaded
        network.network_devices[:] = self.old_devices
        network.pppoe_customer_links[:] = self.old_links
        self.temp_dir.cleanup()

    def test_tag_survives_reload_and_live_read_stays_separate(self):
        payload = network.PppoeCustomerLinkPayload(
            routerId="router-1", username="home123", customerId="customer-1"
        )
        tagged = network.tag_pppoe_customer(payload, admin=self.admin)
        self.assertEqual("customer-1", tagged["customerTag"]["customerId"])
        self.assertEqual("service-1", tagged["customerTag"]["serviceAccountId"])

        saved = json.loads(Path(network.NETWORK_SETTINGS_DATA_PATH).read_text())
        self.assertEqual("home123", saved["pppoeCustomerLinks"][0]["username"])
        network.pppoe_customer_links.clear()
        network._data_loaded = False
        network.load_network_settings_data()
        self.assertEqual("customer-1", network.pppoe_customer_links[0]["customerId"])

        discovered = network.list_pppoe_accounts(admin=self.admin)
        self.assertEqual("Ada Lovelace", discovered["accounts"][0]["customerTag"]["customerName"])
        links = network.list_pppoe_customer_links(customerId="customer-1", refreshLive=True, admin=self.admin)
        self.assertEqual("LIVE", links["links"][0]["availability"])
        self.assertEqual("10.0.0.7", links["links"][0]["account"]["activeAddress"])

        with patch.object(network, "fetch_mikrotik_pppoe_accounts", side_effect=OSError("router offline")):
            unavailable = network.list_pppoe_customer_links(customerId="customer-1", refreshLive=True, admin=self.admin)
        self.assertEqual("ROUTER_UNAVAILABLE", unavailable["links"][0]["availability"])
        self.assertEqual("customer-1", unavailable["links"][0]["customerTag"]["customerId"])
        with patch.object(network, "fetch_mikrotik_pppoe_accounts", return_value=[]):
            missing = network.list_pppoe_customer_links(customerId="customer-1", refreshLive=True, admin=self.admin)
        self.assertEqual("ACCOUNT_MISSING", missing["links"][0]["availability"])

    def test_tag_requires_edit_permission_and_correct_service_owner(self):
        payload = network.PppoeCustomerLinkPayload(
            routerId="router-1", username="home123", customerId="customer-1", serviceAccountId="another-line"
        )
        with self.assertRaises(HTTPException) as forbidden:
            network.tag_pppoe_customer(payload, admin={"username": "viewer", "permissions": ["network-settings.view"]})
        self.assertEqual(403, forbidden.exception.status_code)
        with self.assertRaises(HTTPException) as wrong_line:
            network.tag_pppoe_customer(payload, admin=self.admin)
        self.assertEqual(400, wrong_line.exception.status_code)
        with patch.object(service, "visible_accounts", return_value=[
            {"id": "service-1", "customerId": "customer-1", "serviceAccountNumber": "SA-001"},
            {"id": "service-2", "customerId": "customer-1", "serviceAccountNumber": "SA-002"},
        ]):
            with self.assertRaises(HTTPException) as choose_line:
                network.tag_pppoe_customer(network.PppoeCustomerLinkPayload(
                    routerId="router-1", username="home123", customerId="customer-1"
                ), admin=self.admin)
        self.assertEqual(400, choose_line.exception.status_code)
        self.assertEqual([], network.pppoe_customer_links)

    def test_untag_removes_only_the_local_link(self):
        network.tag_pppoe_customer(network.PppoeCustomerLinkPayload(
            routerId="router-1", username="home123", customerId="customer-1"
        ), admin=self.admin)
        network.untag_pppoe_customer("router-1", "home123", admin=self.admin)
        self.assertEqual([], network.pppoe_customer_links)
        self.assertEqual([], json.loads(Path(network.NETWORK_SETTINGS_DATA_PATH).read_text())["pppoeCustomerLinks"])


if __name__ == "__main__":
    unittest.main()
