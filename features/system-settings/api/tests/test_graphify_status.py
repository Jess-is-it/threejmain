import importlib
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

system_settings = importlib.import_module("system_settings.router")


class GraphifyStatusTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = Path(tempfile.mkdtemp())
        system_settings.GRAPHIFY_OUT_DIR = self.temp_dir
        os.environ["APP_COMMIT"] = "abcdef1234567890abcdef1234567890abcdef12"
        (self.temp_dir / "graph.html").write_text("<html></html>", encoding="utf-8")
        (self.temp_dir / "GRAPH_REPORT.md").write_text("# Graph Report", encoding="utf-8")
        (self.temp_dir / "graph.json").write_text(
            json.dumps(
                {
                    "built_at_commit": "abcdef1234567890abcdef1234567890abcdef12",
                    "graphify_version": "0.9.test",
                    "nodes": [
                        {"id": "SystemSettingsPage", "community": 1},
                        {"id": "router.py", "community": 1},
                        {"id": "Billing", "community": 2},
                    ],
                    "links": [
                        {"source": "SystemSettingsPage", "target": "router.py", "confidence": "EXTRACTED"},
                        {"source": "Billing", "target": "Collector", "confidence": "INFERRED"},
                        {"source": "Ticketing", "target": "Network Settings", "confidence": "AMBIGUOUS"},
                    ],
                }
            ),
            encoding="utf-8",
        )

    def tearDown(self):
        system_settings._graphify_artifact_tickets.clear()
        shutil.rmtree(self.temp_dir)
        os.environ.pop("APP_COMMIT", None)

    def test_public_graphify_status_reads_allowlisted_metadata(self):
        status = system_settings.public_graphify_status()

        self.assertTrue(status["available"])
        self.assertTrue(status["reportAvailable"])
        self.assertTrue(status["metadataAvailable"])
        self.assertEqual(3, status["nodes"])
        self.assertEqual(3, status["relationships"])
        self.assertEqual(2, status["communities"])
        self.assertEqual(1, status["extractedRelationships"])
        self.assertEqual(1, status["inferredRelationships"])
        self.assertEqual(1, status["ambiguousRelationships"])
        self.assertEqual("abcdef1", status["builtAtCommitShort"])
        self.assertEqual("match", status["commitState"])
        self.assertEqual("0.9.test", status["version"])

    def test_graphify_artifact_path_is_limited_to_expected_files(self):
        self.assertEqual(self.temp_dir / "graph.html", system_settings.graphify_artifact_path("graph.html"))
        self.assertIsNone(system_settings.graphify_artifact_path("../.env"))
        self.assertIsNone(system_settings.graphify_artifact_path("missing.html"))

    def test_graphify_permission_gate_allows_legacy_admin_and_scoped_permission(self):
        legacy_admin = {"username": "admin"}
        access_admin = {"username": "viewer", "permissions": ["system.graphify.view"]}
        denied_admin = {"username": "tech", "permissions": ["techportal.dashboard.view"]}

        self.assertEqual(legacy_admin, system_settings.require_permission(legacy_admin, "system.graphify.view"))
        self.assertEqual(access_admin, system_settings.require_permission(access_admin, "system.graphify.view"))
        with self.assertRaises(HTTPException) as raised:
            system_settings.require_permission(denied_admin, "system.graphify.view")
        self.assertEqual(403, raised.exception.status_code)

    def test_graphify_artifact_ticket_is_single_use(self):
        ticket = system_settings.create_graphify_artifact_ticket("graph", {"username": "admin"})

        actor = system_settings.require_graphify_artifact_access("graph", ticket["ticket"], None)
        self.assertEqual("admin", actor["username"])
        with self.assertRaises(HTTPException) as raised:
            system_settings.require_graphify_artifact_access("graph", ticket["ticket"], None)
        self.assertEqual(401, raised.exception.status_code)


if __name__ == "__main__":
    unittest.main()
