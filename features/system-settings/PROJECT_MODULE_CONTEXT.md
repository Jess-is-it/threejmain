# System Settings Module Context

## Purpose

System Settings manages shell configuration pages for branding, business profile, runtime paths, reusable location records, and the system port registry.

## Current Status

- Status: `functional-shell`
- App-shell route: `/system-settings`
- API prefix: `/api/system-settings`
- Frontend entry: `features/system-settings/web/SystemSettingsPage.jsx`
- API entry: `features/system-settings/api/system_settings/router.py`

## Current Scope

- View and update branding/business/deployment settings.
- Manage Network Settings image assets for OLT, NAP, PLC Splitter 1x8, and PLC Splitter 1x16 under Images.
- Manage shared map tile providers under Maps. Operators can enable/disable providers, choose the default provider, edit XYZ-style URL templates, set provider type/attribution/min-max zoom, store optional public API key/token values, and add/remove custom providers.
- Manage backup downloads and restore uploads under Backup:
  - Configuration backup exports/restores current app-shell branding/business/deployment settings, persisted System Settings data, and persisted Network Settings data.
  - Full system backup includes the configuration backup plus supported PostgreSQL application tables, currently Customer Profiling durable customer records when `DATABASE_URL` is available.
  - Backup files intentionally include secrets needed for immediate restore, such as OPENAI API keys, MikroTik API passwords, SNMP communities, SNMPv3 credentials, access users, and uploaded image data.
- Manage customer-information avatar moods for neutral, happy, sad, angry, offline, support, maintenance, warning, and resolved account contexts, with separate Male and Female upload slots.
- Manage the customer avatar emotion guide under Avatar -> Settings. The guide stores score thresholds and module signal weights used by shared customer mood resolution.
- Manage OPENAI settings, including masked API key status, selected model, selected reasoning effort, model pricing reference, and a live Responses API test.
- Manage A2P Messaging settings copied from the 3JCentralPisowifi System Settings flow:
  - Smart Messaging Suite provider/base URL/path settings.
  - API key header credentials with API ID/API Key fields plus Basic Auth/body credential compatibility.
  - Registered Sender IDs, default sender, delivery receipt preference, local monthly credit rules, Smart credits check, and test SMS send.
  - Local message logs for success, failed, and pending SMS attempts.
- Manage system-login access controls under Access:
  - Auth Settings for login enablement, session timeout, audit retention, SMTP forgot-password email, and SMTP test email.
  - Permissions catalog with system-managed permission codes grouped by feature.
  - Roles CRUD with permission assignment and automatic required view-permission dependencies.
  - Users CRUD with role assignment, active/inactive status, force password change, password reset, email reset, and owner lockouts.
- Manage reusable Location Management records with address, municipality, barangay, province, region, coordinates, geocoder source, and notes.
- Preload known Customer Profiling service-area barangays into Location Management.
- Suppress deleted preloaded Location Management rows from automatic reseeding across API restarts.
- Search geocoder suggestions through Nominatim-compatible `GEOCODER_SEARCH_URL` and manually enter location records when search is unavailable.
- Edit saved locations so incomplete records created from customer forms can be completed later.
- Use switch-driven multiple select in Location Management to bulk delete selected records; edit/add controls are hidden while selection mode is active.
- View reserved ports used by the app and related 3JCentralPisowifi services, with explicit Production and Staging labels.
- Keep compatibility API routes for `/api/system/settings`, `/api/system/ports`, and `/api/locations`.

## Integration Notes

- App-shell imports `SystemSettingsPage` and passes `refreshShell`.
- App-shell calls `configure_system_settings(current_admin, add_audit, settings, port_registry)`.
- The port registry provider includes threejmain Production (`8180` web, `8100` API), threejmain Staging (`8280` web, `8200` API), internal PostgreSQL container ports for both Compose projects, and existing 3JCentralPisowifi reserved/in-use ports.
- Branding/business/deployment settings persist to `SYSTEM_SETTINGS_DATA_PATH` and are included in Backup exports/restores.
- Location Management records, deleted preload markers, Network Settings image assets, shared map provider settings, avatar images, avatar emotion guide settings, OPENAI settings, and A2P Messaging settings/logs persist to `SYSTEM_SETTINGS_DATA_PATH` (`/app/data/system_settings.json` in Docker Compose) through the `threejmain_api_data` named volume.
- Map/image asset endpoints are module-owned under `/api/system-settings/map-images`; accepted uploads are PNG, JPG/JPEG, and WebP images up to 512 KB. `GET /api/system-settings/map-images` returns upload guidelines, target metadata, and any saved image data URLs. `PUT/DELETE /api/system-settings/map-images/{target_id}` manages `nap`, `olt`, `plc-splitter-1x8`, and `plc-splitter-1x16` image assets for Network Settings.
- Map provider endpoints are module-owned under `/api/system-settings/map-providers` with compatibility routes at `/api/system/map-providers`. `GET` returns normalized provider settings; `PATCH` saves the default provider id and provider rows. Built-in defaults include enabled Esri Street, Esri Satellite, and OpenStreetMap plus disabled key-based templates for Google Roadmap/Satellite, TomTom Basic, MapTiler streets/satellite, and Mapbox streets/satellite. Google providers use the official Google Map Tiles API session-token flow and require a Google API key with Map Tiles API enabled. The System Settings -> Maps UI groups provider cards by vendor tabs such as Google/Esri/Mapbox and nested map-type tabs such as Street/Satellite. `features/system-settings/web/mapProviders.js` is the shared frontend helper used by Network Settings and Customer Profiling to normalize provider settings, create provider sessions when needed, and expand tile URLs.
- Backup endpoints are module-owned under `/api/system-settings/backups`: `GET /api/system-settings/backups` returns metadata/counts, `GET /api/system-settings/backups/configuration` downloads a restorable configuration JSON file, `GET /api/system-settings/backups/full` downloads configuration plus supported PostgreSQL app data, and `POST /api/system-settings/backups/restore` restores an uploaded backup JSON. Configuration restore writes `SYSTEM_SETTINGS_DATA_PATH` and `NETWORK_SETTINGS_DATA_PATH`; Network Settings runtime globals are refreshed immediately when the module is loaded. Full restore also replaces supported application table rows; migration metadata is exported but not restored.
- Avatar endpoints are module-owned under `/api/system-settings/avatars`; accepted uploads are PNG, JPG/JPEG, WebP, and GIF images up to 1 MB.
- Gender-specific avatar endpoints are `PUT/DELETE /api/system-settings/avatars/{gender_id}/{emotion_id}` where `gender_id` is `male` or `female`. The older `PUT/DELETE /api/system-settings/avatars/{emotion_id}` route remains as male-slot compatibility.
- `PATCH /api/system-settings/avatar-emotion-settings` updates the reusable scoring thresholds/weights returned by `GET /api/system-settings/avatars`.
- Shared reusable frontend code lives in `features/system-settings/web/avatarEmotion.js` and `features/system-settings/web/CustomerEmotionAvatar.jsx`. Customer-facing modules can import `CustomerEmotionAvatar` or `customerAvatarViewModel` to display the configured avatar and current behavior score.
- OPENAI endpoints are `GET/PATCH /api/system-settings/openai` for configuration and `POST /api/system-settings/openai/test` for a live Responses API test. API keys are never returned in full to the frontend. The test request sends `reasoning: {"effort": <selected effort>}` for the selected model, limited to that model's supported efforts.
- A2P Messaging endpoints are `GET/PATCH /api/system-settings/a2p-messaging`, `POST /api/system-settings/a2p-messaging/check-credits`, `POST /api/system-settings/a2p-messaging/test-send`, and `GET /api/system-settings/a2p-messaging/messages`. A2P API keys/passwords are never returned in full to the frontend. Test sends append local message logs and refresh the app-shell notification bell.
- App-shell notification endpoints are exposed by this module at `/api/admin/notifications`, `/api/admin/notifications/read-all`, and `/api/admin/notifications/{notification_id}/read`. The shared top-nav bell uses these generated A2P success/failure notifications.
- Access endpoints are under `/api/system-settings/access`. System-login administration was moved here from the old Account Admin area to match the old `/home/threejmon` System Settings -> Access pattern.
- Access data persists to `SYSTEM_SETTINGS_DATA_PATH` in this first shell. App-shell login now accepts System Settings -> Access users while keeping the legacy `admin` fallback. Access seeds Tech Portal permission codes, a built-in `technician` role, and a temporary active test user `tech` / `tech12345` for Tech Portal testing. Full per-module permission enforcement beyond the technician UI restriction is still future work.
- Location endpoints are module-owned under `/api/system-settings/locations` with `/api/locations` compatibility routes for workflows copied from 3JCentralPisowifi. Create, edit, delete, bulk delete, and customer-created minimal location records are persisted.
- `PATCH /api/system-settings/locations/{location_id}` updates saved location metadata.
- `POST /api/system-settings/locations/bulk-delete` removes selected location ids and has `/api/locations/bulk-delete` compatibility.
- Customer Profiling uses the exported `ensure_location_record` helper to link or create minimal location records during customer create/update.
