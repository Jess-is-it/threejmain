import importlib
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

system_settings = importlib.import_module("system_settings.router")


class FakeJsonResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, _exc_type, _exc, _traceback):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class ManualLocationManagementTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = Path(tempfile.mkdtemp())
        self.data_path = self.temp_dir / "system_settings.json"
        self.previous_data_path = system_settings.os.environ.get("SYSTEM_SETTINGS_DATA_PATH")
        system_settings.os.environ["SYSTEM_SETTINGS_DATA_PATH"] = str(self.data_path)
        self.store = {"branding": {}, "business": {}, "deployment": {}}
        self.audit_events = []
        self.admin = {"id": "admin-1", "username": "admin", "permissions": ["*"]}
        self.configure()

    def configure(self):
        system_settings.configure_system_settings(
            lambda _authorization=None: self.admin,
            lambda action, target_type, target_id, details, actor: self.audit_events.append(
                (action, target_type, target_id, details, actor)
            ),
            self.store,
            lambda: [],
        )

    def tearDown(self):
        if self.previous_data_path is None:
            system_settings.os.environ.pop("SYSTEM_SETTINGS_DATA_PATH", None)
        else:
            system_settings.os.environ["SYSTEM_SETTINGS_DATA_PATH"] = self.previous_data_path
        shutil.rmtree(self.temp_dir)

    def create_manual_location(self):
        return system_settings.create_location(
            system_settings.LocationPayload(
                location_name="Main Office",
                address="Centro, Cabagan, Isabela",
                municipality="Cabagan",
                barangay="Centro",
                province="Isabela",
                latitude=17.4261,
                longitude=121.7692,
                geocode_source="NOMINATIM",
                raw_geocode={"source": "must not persist"},
            ),
            self.admin,
        )

    def test_location_created_from_system_settings_is_always_manual(self):
        location = self.create_manual_location()

        self.assertEqual("MANUAL", location["geocode_source"])
        self.assertEqual("Centro", location["location_name"])
        self.assertEqual("Centro, Cabagan, Isabela", location["address"])
        self.assertEqual({}, location["raw_geocode"])
        self.assertEqual(17.4261, location["latitude"])
        self.assertEqual(121.7692, location["longitude"])
        self.assertEqual("system_location_created", self.audit_events[-1][0])

        persisted = json.loads(self.data_path.read_text(encoding="utf-8"))
        self.assertEqual(["MANUAL"], [row["geocode_source"] for row in persisted["locations"]])
        self.assertNotIn("deleted_default_location_fingerprints", persisted)

    def test_location_update_derives_name_and_address_from_barangay(self):
        location = self.create_manual_location()

        updated = system_settings.update_location(
            location["id"],
            system_settings.LocationPatchPayload(
                location_name="Redundant custom name",
                address="Redundant custom address",
                municipality="Enrile",
                barangay="Alibago",
                province="Cagayan",
            ),
            self.admin,
        )

        self.assertEqual("Alibago", updated["location_name"])
        self.assertEqual("Alibago, Enrile, Cagayan", updated["address"])

    def test_system_location_requires_barangay(self):
        with self.assertRaises(HTTPException) as raised:
            system_settings.create_location(
                system_settings.LocationPayload(
                    location_name="Custom name",
                    address="Custom address",
                    municipality="Enrile",
                ),
                self.admin,
            )

        self.assertEqual(400, raised.exception.status_code)
        self.assertIn("barangay", raised.exception.detail.lower())

    def test_customer_profile_resolution_links_or_creates_manual_locations(self):
        manual = self.create_manual_location()

        linked = system_settings.ensure_location_record(
            {
                "locationId": manual["id"],
                "location_name": "Main Office",
                "address": "Centro, Cabagan, Isabela",
                "municipality": "Cabagan",
                "barangay": "Centro",
                "province": "Isabela",
            },
            actor=self.admin,
        )
        created = system_settings.ensure_location_record(
            {
                "location_name": "Alibago",
                "address": "Purok 1, Alibago, Enrile, Cagayan",
                "municipality": "Enrile",
                "barangay": "Alibago",
                "province": "Cagayan",
            },
            actor=self.admin,
        )

        self.assertEqual(manual["id"], linked["id"])
        self.assertEqual(manual["address"], linked["address"])
        self.assertIsNotNone(created)
        self.assertEqual("MANUAL", created["geocode_source"])
        self.assertEqual(2, len(system_settings.list_locations(self.admin)))
        persisted = json.loads(self.data_path.read_text(encoding="utf-8"))
        self.assertEqual(2, len(persisted["locations"]))

    def test_existing_manual_location_id_remains_authoritative_for_customer_link(self):
        manual = self.create_manual_location()
        linked = system_settings.ensure_location_record(
            {
                "locationId": manual["id"],
                "location_name": "Balasig",
                "address": "Purok 2, Balasig, Cabagan, Isabela",
                "municipality": "Cabagan",
                "barangay": "Balasig",
                "province": "Isabela",
            },
            actor=self.admin,
        )

        self.assertEqual(manual["id"], linked["id"])
        self.assertEqual("Centro", linked["barangay"])
        self.assertEqual(1, len(system_settings.list_locations(self.admin)))

    def test_legacy_automatic_locations_are_removed_when_store_loads(self):
        rows = [
            {"id": "manual", "address": "Manual address", "geocode_source": "MANUAL"},
            {"id": "preloaded", "address": "Seed address", "geocode_source": "PRELOADED"},
            {"id": "customer", "address": "Customer address", "geocode_source": "CUSTOMER_PROFILING"},
            {"id": "nominatim", "address": "Search address", "geocode_source": "NOMINATIM"},
        ]
        self.data_path.write_text(
            json.dumps({
                "locations": rows,
                "deleted_default_location_fingerprints": [["A", "B", "C", "D"]],
            }),
            encoding="utf-8",
        )
        self.configure()

        locations = system_settings.list_locations(self.admin)

        self.assertEqual(["manual"], [location["id"] for location in locations])
        persisted = json.loads(self.data_path.read_text(encoding="utf-8"))
        self.assertEqual(["manual"], [location["id"] for location in persisted["locations"]])
        self.assertNotIn("deleted_default_location_fingerprints", persisted)

    def test_address_search_endpoint_is_disabled(self):
        with self.assertRaises(HTTPException) as raised:
            system_settings.search_locations("Cabagan", self.admin)

        self.assertEqual(410, raised.exception.status_code)
        self.assertIn("must be added manually", raised.exception.detail)

    def test_coordinate_place_search_returns_normalized_results_without_persisting(self):
        payload = {
            "candidates": [
                {
                    "address": "Tuguegarao City Hall",
                    "location": {"x": 121.753749, "y": 17.650678},
                    "score": 100,
                    "attributes": {
                        "PlaceName": "Tuguegarao City Hall",
                        "LongLabel": "Tuguegarao City Hall, Tuguegarao City, Cagayan, Philippines",
                        "Type": "Civic Center",
                    },
                },
            ],
        }
        with patch.object(system_settings.urllib.request, "urlopen", return_value=FakeJsonResponse(payload)) as mocked:
            result = system_settings.search_map_places(
                "Tuguegarao City Hall",
                latitude=17.559311,
                longitude=121.684928,
                limit=6,
                admin=self.admin,
            )

        self.assertEqual("Tuguegarao City Hall", result["items"][0]["name"])
        self.assertEqual("government", result["items"][0]["category"])
        self.assertEqual(17.650678, result["items"][0]["latitude"])
        self.assertEqual([], system_settings.list_locations(self.admin))
        request_url = mocked.call_args.args[0].full_url
        parameters = system_settings.urllib.parse.parse_qs(system_settings.urllib.parse.urlparse(request_url).query)
        self.assertEqual(["PH"], parameters["sourceCountry"])
        self.assertEqual(["121.684928,17.559311"], parameters["location"])
        self.assertEqual(["false"], parameters["forStorage"])

    def test_nearby_landmarks_return_checkable_categories(self):
        payload = {
            "candidates": [
                {
                    "address": "Enrile West Central School",
                    "location": {"x": 121.69215, "y": 17.56075},
                    "score": 100,
                    "attributes": {"PlaceName": "Enrile West Central School", "Type": "School"},
                },
                {
                    "address": "Enrile Police Station",
                    "location": {"x": 121.691198, "y": 17.521046},
                    "score": 100,
                    "attributes": {"PlaceName": "Enrile Police Station", "Type": "Police Station"},
                },
            ],
        }
        with patch.object(system_settings.urllib.request, "urlopen", return_value=FakeJsonResponse(payload)) as mocked:
            result = system_settings.nearby_map_landmarks(
                latitude=17.559311,
                longitude=121.684928,
                radius_m=5000,
                limit=30,
                admin=self.admin,
            )

        self.assertEqual(["education", "government"], [item["category"] for item in result["items"]])
        self.assertEqual(
            {"education": 1, "government": 1},
            {category["id"]: category["count"] for category in result["categories"]},
        )
        parameters = system_settings.urllib.parse.parse_qs(
            system_settings.urllib.parse.urlparse(mocked.call_args.args[0].full_url).query
        )
        self.assertEqual(["POI"], parameters["category"])
        self.assertEqual(["5000"], parameters["distance"])

    def test_bulk_barangay_create_saves_multiple_manual_locations(self):
        result = system_settings.bulk_create_barangay_locations(
            system_settings.LocationBulkBarangayPayload(
                municipality="Enrile",
                province="Cagayan",
                region="Region II",
                barangays=["Alibago", "Batu", "Divisoria"],
                notes="Municipality catalog import",
            ),
            self.admin,
        )

        self.assertEqual(3, result["created"])
        self.assertEqual([], result["skipped"])
        self.assertEqual(
            ["Alibago", "Batu", "Divisoria"],
            [location["barangay"] for location in result["locations"]],
        )
        self.assertTrue(all(location["geocode_source"] == "MANUAL" for location in result["locations"]))
        self.assertEqual("Alibago, Enrile, Cagayan", result["locations"][0]["address"])
        self.assertEqual("system_location_barangays_bulk_created", self.audit_events[-1][0])

        persisted = json.loads(self.data_path.read_text(encoding="utf-8"))
        self.assertEqual(3, len(persisted["locations"]))

    def test_bulk_barangay_create_skips_existing_and_repeated_names(self):
        self.create_manual_location()

        result = system_settings.bulk_create_barangay_locations(
            system_settings.LocationBulkBarangayPayload(
                municipality="Cabagan",
                province="Isabela",
                barangays=["Centro", "CENTRO", "Balasig"],
            ),
            self.admin,
        )

        self.assertEqual(1, result["created"])
        self.assertEqual("Balasig", result["locations"][0]["barangay"])
        self.assertEqual(
            ["already_exists", "repeated_in_request"],
            [entry["reason"] for entry in result["skipped"]],
        )
        self.assertEqual(2, len(system_settings.list_locations(self.admin)))

    def test_bulk_barangay_create_rejects_blank_names(self):
        with self.assertRaises(HTTPException) as raised:
            system_settings.bulk_create_barangay_locations(
                system_settings.LocationBulkBarangayPayload(
                    municipality="Enrile",
                    barangays=[" ", ""],
                ),
                self.admin,
            )

        self.assertEqual(400, raised.exception.status_code)
        self.assertIn("barangay", raised.exception.detail.lower())


if __name__ == "__main__":
    unittest.main()
