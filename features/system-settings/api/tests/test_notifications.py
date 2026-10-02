import importlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
system_settings = importlib.import_module("system_settings.router")


class NotificationRecipientTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.previous_data_path = system_settings.os.environ.get("SYSTEM_SETTINGS_DATA_PATH")
        self.data_path = Path(self.temp_dir.name) / "system_settings.json"
        system_settings.os.environ["SYSTEM_SETTINGS_DATA_PATH"] = str(self.data_path)
        self.store = {"branding": {}, "business": {}, "deployment": {}}
        system_settings.configure_system_settings(
            lambda _authorization=None: self.alice,
            lambda *_args: None,
            self.store,
            lambda: [],
        )
        self.alice = {"id": "user-alice", "username": "alice", "role": "collector"}
        self.bob = {"id": "user-bob", "username": "bob", "role": "collector"}

    def tearDown(self):
        if self.previous_data_path is None:
            system_settings.os.environ.pop("SYSTEM_SETTINGS_DATA_PATH", None)
        else:
            system_settings.os.environ["SYSTEM_SETTINGS_DATA_PATH"] = self.previous_data_path
        self.temp_dir.cleanup()

    def log_sms(self, owner):
        return system_settings.record_a2p_message_log(
            status="SUCCESS",
            destination="09171234567",
            source="3J BILL",
            message_text="Payment received",
            purpose="COLLECTOR_PAYMENT_CONFIRMATION",
            created_by_admin_id=owner,
        )

    def test_bell_lists_only_the_signed_in_users_messages(self):
        alice_id = self.log_sms(self.alice["id"])
        bob_id = self.log_sms(self.bob["id"])
        self.log_sms(self.alice["username"])
        self.log_sms(None)
        legacy_id = self.log_sms("legacy")
        system_settings.a2p_messaging_store()["notificationReadIds"] = [f"a2p-{alice_id}"]

        alice_items = system_settings.list_admin_notifications(admin=self.alice)["items"]
        bob_items = system_settings.list_admin_notifications(admin=self.bob)["items"]
        legacy_items = system_settings.list_admin_notifications(admin={"username": "legacy"})["items"]

        self.assertEqual([f"a2p-{alice_id}"], [item["id"] for item in alice_items])
        self.assertEqual([f"a2p-{bob_id}"], [item["id"] for item in bob_items])
        self.assertEqual([f"a2p-{legacy_id}"], [item["id"] for item in legacy_items])
        self.assertEqual("UNREAD", alice_items[0]["status"])
        self.assertEqual("UNREAD", bob_items[0]["status"])

    def test_read_actions_cannot_change_another_users_notifications(self):
        alice_id = self.log_sms(self.alice["id"])
        bob_id = self.log_sms(self.bob["id"])

        with self.assertRaises(HTTPException) as cross_user_read:
            system_settings.mark_admin_notification_read(f"a2p-{bob_id}", admin=self.alice)
        self.assertEqual(404, cross_user_read.exception.status_code)

        system_settings.mark_all_admin_notifications_read(admin=self.alice)
        self.assertEqual(0, system_settings.list_admin_notifications(admin=self.alice)["unread_count"])
        self.assertEqual(1, system_settings.list_admin_notifications(admin=self.bob)["unread_count"])

        marked = system_settings.mark_admin_notification_read(f"a2p-{bob_id}", admin=self.bob)
        self.assertEqual("READ", marked["status"])
        persisted = json.loads(self.data_path.read_text(encoding="utf-8"))["a2pMessaging"]
        self.assertEqual([f"a2p-{alice_id}"], persisted["notificationReadIdsByUser"][self.alice["id"]])
        self.assertEqual([f"a2p-{bob_id}"], persisted["notificationReadIdsByUser"][self.bob["id"]])


if __name__ == "__main__":
    unittest.main()
