import importlib
import sys
import unittest
from pathlib import Path


FEATURES = Path(__file__).resolve().parents[3]
for module_name in ("account-access-management", "customer-profiling", "network-settings", "service", "ticketing"):
    sys.path.insert(0, str(FEATURES / module_name / "api"))

network = importlib.import_module("network_settings.router")
access = importlib.import_module("account_access_management.router")


class PppoeCustomerTagBridgeTests(unittest.TestCase):
    def setUp(self):
        self.old_loaded = network._data_loaded
        self.old_links = list(network.pppoe_customer_links)
        network._data_loaded = True
        network.pppoe_customer_links[:] = [{
            "routerId": "router-1", "username": "home123", "customerId": "customer-1",
            "accountSnapshot": {"routerName": "Router A", "status": "OFFLINE"},
        }]

    def tearDown(self):
        network._data_loaded = self.old_loaded
        network.pppoe_customer_links[:] = self.old_links

    def test_discovered_account_and_persisted_tag_share_one_key(self):
        discovered = {"id": "router-1:A", "routerId": "router-1", "username": "home123"}
        self.assertEqual("router-1:home123", access.pppoe_binding_key(discovered))
        self.assertIn(access.pppoe_binding_key(discovered), access.binding_map())
        customer = {"id": "customer-1", "accountNumber": "C-001"}
        self.assertEqual(customer, access.customer_for_pppoe(discovered, [customer]))

    def test_username_similarity_cannot_create_a_customer_tag(self):
        discovered = {"routerId": "router-1", "username": "customer-2-name"}
        customers = [{"id": "customer-2", "accountNumber": "customer-2", "fullName": "Customer Two"}]
        self.assertIsNone(access.customer_for_pppoe(discovered, customers))


if __name__ == "__main__":
    unittest.main()
