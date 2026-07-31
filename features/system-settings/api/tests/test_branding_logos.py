import base64
import importlib
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

system_settings = importlib.import_module("system_settings.router")


def data_url(mime_type, raw):
    return f"data:{mime_type};base64,{base64.b64encode(raw).decode('ascii')}"


class BrandingLogoTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = Path(tempfile.mkdtemp())
        self.previous_data_path = system_settings.os.environ.get("SYSTEM_SETTINGS_DATA_PATH")
        system_settings.os.environ["SYSTEM_SETTINGS_DATA_PATH"] = str(self.temp_dir / "system_settings.json")
        self.store = {
            "branding": {
                "display_name": "3J ISP Management",
                "portal_subtitle": "Small ISP operations dashboard",
                "accent_color": "#206bc4",
            },
            "business": {},
            "deployment": {},
        }
        self.audit_events = []
        system_settings.configure_system_settings(
            lambda _authorization=None: {"id": "admin-1", "username": "admin", "permissions": ["*"]},
            lambda action, target_type, target_id, details, actor: self.audit_events.append((action, target_type, target_id, details, actor)),
            self.store,
            lambda: [],
        )
        self.admin = {"id": "admin-1", "username": "admin", "permissions": ["*"]}

    def tearDown(self):
        if self.previous_data_path is None:
            system_settings.os.environ.pop("SYSTEM_SETTINGS_DATA_PATH", None)
        else:
            system_settings.os.environ["SYSTEM_SETTINGS_DATA_PATH"] = self.previous_data_path
        shutil.rmtree(self.temp_dir)

    def test_company_logo_upload_creates_public_url_without_exposing_raw_data(self):
        raw = b"\x89PNG\r\n\x1a\ncompany-logo"
        payload = system_settings.BrandingImageUploadPayload(
            data_url=data_url("image/png", raw),
            file_name="company.png",
            mime_type="image/png",
        )

        saved = system_settings.save_branding_asset("company_logo", payload, self.admin)
        branding = saved["branding"]

        self.assertEqual("image/png", branding["company_logo"]["mime_type"])
        self.assertTrue(branding["company_logo_url"].startswith("/api/public/branding/company-logo?v="))
        public_payload = system_settings.public_branding_payload()
        self.assertNotIn("company_logo", public_payload)
        self.assertTrue(public_payload["company_logo_url"].startswith("/api/public/branding/company-logo?v="))

        response = system_settings.public_branding_asset_response("company_logo")
        self.assertEqual(200, response.status_code)
        self.assertEqual("image/png", response.media_type)
        self.assertEqual(raw, response.body)
        self.assertEqual("system_branding_asset_uploaded", self.audit_events[-1][0])

    def test_browser_logo_accepts_ico_for_favicon(self):
        raw = b"\x00\x00\x01\x00browser-logo"
        payload = system_settings.BrandingImageUploadPayload(
            data_url=data_url("application/octet-stream", raw),
            file_name="favicon.ico",
            mime_type="application/octet-stream",
        )

        saved = system_settings.save_branding_asset("browser_logo", payload, self.admin)
        branding = saved["branding"]

        self.assertEqual("image/x-icon", branding["browser_logo"]["mime_type"])
        self.assertEqual("image/x-icon", branding["browser_logo_type"])
        self.assertTrue(branding["browser_logo_url"].startswith("/api/public/branding/browser-logo?v="))
        response = system_settings.public_branding_asset_response("browser_logo")
        self.assertEqual("image/x-icon", response.media_type)
        self.assertEqual(raw, response.body)

    def test_branding_upload_rejects_declared_mime_that_does_not_match_signature(self):
        raw = b"\xff\xd8\xffnot-a-png"
        payload = system_settings.BrandingImageUploadPayload(
            data_url=data_url("image/png", raw),
            file_name="wrong.png",
            mime_type="image/png",
        )

        with self.assertRaises(HTTPException) as raised:
            system_settings.decode_branding_image_data_url("company_logo", payload)
        self.assertEqual(400, raised.exception.status_code)
        self.assertIn("MIME type does not match", raised.exception.detail)


if __name__ == "__main__":
    unittest.main()
