"""Safety gates for the staging-only subscriber reset; no real data is deleted."""

import importlib
import os
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi import HTTPException


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
reset = importlib.import_module("customer_profiling.staging_reset")


class StagingResetSafetyTests(unittest.TestCase):
    def setUp(self):
        reset._previews.clear()
        self.owner = {"id": "owner-1", "role": "owner", "username": "owner"}

    def tearDown(self):
        reset._previews.clear()

    def test_unavailable_outside_staging_even_for_owner(self):
        with patch.dict(os.environ, {"APP_ENV": "production", "APP_BRANCH": "master", "DATABASE_URL": "postgresql://test"}):
            with self.assertRaises(HTTPException) as raised:
                reset.require_staging_owner(self.owner)
        self.assertEqual(raised.exception.status_code, 404)

    def test_non_owner_cannot_preview_or_reset(self):
        with patch.dict(os.environ, {"APP_ENV": "staging", "APP_BRANCH": "staging", "DATABASE_URL": "postgresql://test"}):
            with self.assertRaises(HTTPException) as raised:
                reset.require_staging_owner({"id": "staff-1", "role": "admin"})
        self.assertEqual(raised.exception.status_code, 403)

    def test_exact_phrase_required_before_database_connection(self):
        with patch.dict(os.environ, {"APP_ENV": "staging", "APP_BRANCH": "staging", "DATABASE_URL": "postgresql://test"}):
            with patch.object(reset, "psycopg", MagicMock()), patch.object(reset, "dict_row", object()), patch.object(reset, "tuple_row", object()):
                with self.assertRaises(HTTPException) as raised:
                    reset.execute_staging_reset(self.owner, "any-token", "reset")
        self.assertEqual(raised.exception.status_code, 400)

    def test_expired_preview_rejected_before_database_connection(self):
        reset._previews["expired"] = {"actorId": "owner-1", "fingerprint": "before", "expiresAt": time.time() - 1}
        with patch.dict(os.environ, {"APP_ENV": "staging", "APP_BRANCH": "staging", "DATABASE_URL": "postgresql://test"}):
            with patch.object(reset, "psycopg", MagicMock()) as driver, patch.object(reset, "dict_row", object()), patch.object(reset, "tuple_row", object()):
                with self.assertRaises(HTTPException) as raised:
                    reset.execute_staging_reset(self.owner, "expired", reset.CONFIRMATION_PHRASE)
                driver.connect.assert_not_called()
        self.assertEqual(raised.exception.status_code, 409)

    def test_backup_failure_prevents_any_delete(self):
        reset._previews["ready"] = {"actorId": "owner-1", "fingerprint": "same", "expiresAt": time.time() + 60}
        counts = {"inventoryAssignments": 0, "posCustomerRecords": 0}
        driver = MagicMock()
        cursor = driver.connect.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value
        with patch.dict(os.environ, {"APP_ENV": "staging", "APP_BRANCH": "staging", "DATABASE_URL": "postgresql://test"}):
            with patch.object(reset, "psycopg", driver), patch.object(reset, "dict_row", object()), patch.object(reset, "tuple_row", object()):
                with patch.object(reset, "_snapshot", return_value=(counts, "same")), patch.object(reset, "_save_backup", side_effect=HTTPException(status_code=503, detail="backup failed")):
                    with self.assertRaises(HTTPException) as raised:
                        reset.execute_staging_reset(self.owner, "ready", reset.CONFIRMATION_PHRASE)
        self.assertEqual(raised.exception.status_code, 503)
        self.assertFalse(any(str(call.args[0]).startswith("DELETE") for call in cursor.execute.call_args_list))


if __name__ == "__main__":
    unittest.main()
