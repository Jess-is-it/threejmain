# System Settings

System Settings owns operator-facing configuration for the ISP management shell.

## Scope

- Branding and business profile fields
- Location Management for reusable site addresses, municipality/barangay details, coordinates, and geocoder autofill
- Avatar mood uploads for customer-information screens, separated by Male/Female customer avatar slots
- Avatar emotion scoring guide for customer-facing module behavior badges
- OPENAI settings for API key storage, model and reasoning-effort selection, model pricing reference, and live API testing
- Access tab for system-login Auth Settings, Permissions, Roles, and Users
- System port registry viewer with separate Production and Staging labels for threejmain web/API ports
- Runtime path visibility

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
- Avatar endpoints:
  - `GET /api/system-settings/avatars`
  - `PATCH /api/system-settings/avatar-emotion-settings`
  - `PUT /api/system-settings/avatars/{gender_id}/{emotion_id}`
  - `DELETE /api/system-settings/avatars/{gender_id}/{emotion_id}`
  - `PUT /api/system-settings/avatars/{emotion_id}`
  - `DELETE /api/system-settings/avatars/{emotion_id}`
- Location endpoints:
  - `GET /api/system-settings/locations`
  - `GET /api/system-settings/locations/search?q=<text>`
  - `POST /api/system-settings/locations`
  - `POST /api/system-settings/locations/bulk-delete`
  - `PATCH /api/system-settings/locations/{location_id}`
  - `DELETE /api/system-settings/locations/{location_id}`
- OPENAI endpoints:
  - `GET /api/system-settings/openai`
  - `PATCH /api/system-settings/openai`
  - `POST /api/system-settings/openai/test`
- Access endpoints:
  - `GET /api/system-settings/access`
  - `PATCH /api/system-settings/access/auth-settings`
  - `POST /api/system-settings/access/auth-settings/test-email`
  - `POST /api/system-settings/access/roles`
  - `PATCH /api/system-settings/access/roles/{role_id}`
  - `DELETE /api/system-settings/access/roles/{role_id}`
  - `POST /api/system-settings/access/users`
  - `PATCH /api/system-settings/access/users/{user_id}`
  - `POST /api/system-settings/access/users/{user_id}/reset-password`
  - `DELETE /api/system-settings/access/users/{user_id}`
- Compatibility endpoints retained:
  - `/api/system/settings`
  - `/api/system/ports`
  - `/api/locations`
  - `/api/locations/search`
  - `/api/locations/bulk-delete`
  - `/api/locations/{location_id}`

## Integration Notes

The app-shell configures this module with shared auth, audit logging, the shared settings store, and the port registry provider. The Ports tab lists threejmain Production ports (`8180` web, `8100` API), threejmain Staging ports (`8280` web, `8200` API), their internal PostgreSQL container ports, and existing 3JCentralPisowifi reservations.
Location Management preloads the existing Customer Profiling service-area barangays and exposes edit actions so incomplete customer-created locations can be completed later. The table includes a switch-driven multiple select mode for bulk deleting selected locations; edit/add actions are hidden while selection mode is active. Deleted preloaded locations are suppressed from automatic reseeding and persisted.
Location records, deleted preload markers, avatar images, and avatar emotion guide settings are written to `SYSTEM_SETTINGS_DATA_PATH` (`/app/data/system_settings.json` in Docker Compose) so they survive API container restarts and rebuilds through the `threejmain_api_data` named volume. Accepted avatar formats are PNG, JPG/JPEG, WebP, and GIF, with a 1 MB maximum per image. Long-term production storage should still move to shared PostgreSQL and file/object storage before production use.
Reusable frontend avatar behavior code lives in `web/avatarEmotion.js` and `web/CustomerEmotionAvatar.jsx`. Customer-facing modules can import the component or resolver to display the current avatar, gender slot, mood score, and emotion label from the shared Avatar settings.
OPENAI settings are stored in the same `SYSTEM_SETTINGS_DATA_PATH` file. The API returns only masked key metadata to the frontend, stores the selected model, selected reasoning effort, and optional organization/project ids, exposes current model pricing metadata, and tests connectivity through the OpenAI Responses API.
Access settings are also stored in `SYSTEM_SETTINGS_DATA_PATH` for this shell. The Access tab mirrors the old `/home/threejmon` System Settings -> Access surface: Auth Settings, Permissions, Roles, and Users. Role and user records are in-memory/persisted JSON for now and are not yet wired into app-shell login enforcement.
