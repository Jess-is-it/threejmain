# System Settings

System Settings owns operator-facing configuration for the ISP management shell.

## Scope

- Branding and business profile fields
- Location Management for reusable site addresses, municipality/barangay details, coordinates, and geocoder autofill
- System port registry viewer
- Runtime path visibility
- Access reminders that point role management to Account Admin

## Module Layout

```text
system-settings/
  api/system_settings/__init__.py
  api/system_settings/router.py
  web/SystemSettingsPage.jsx
  web/systemSettings.css
  README.md
  module.json
  PROJECT_MODULE_CONTEXT.md
```

## API

- Prefix: `/api/system-settings`
- Location endpoints:
  - `GET /api/system-settings/locations`
  - `GET /api/system-settings/locations/search?q=<text>`
  - `POST /api/system-settings/locations`
  - `DELETE /api/system-settings/locations/{location_id}`
- Compatibility endpoints retained:
  - `/api/system/settings`
  - `/api/system/ports`
  - `/api/locations`
  - `/api/locations/search`
  - `/api/locations/{location_id}`

## Integration Notes

The app-shell configures this module with shared auth, audit logging, the shared settings store, and the port registry provider.
Location records are in-memory in this first shell and should move to shared PostgreSQL persistence before production use.
