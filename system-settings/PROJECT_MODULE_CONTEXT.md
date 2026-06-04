# System Settings Module Context

## Purpose

System Settings manages shell configuration pages for branding, business profile, runtime paths, reusable location records, and the system port registry.

## Current Status

- Status: `functional-shell`
- App-shell route: `/system-settings`
- API prefix: `/api/system-settings`
- Frontend entry: `system-settings/web/SystemSettingsPage.jsx`
- API entry: `system-settings/api/system_settings/router.py`

## Current Scope

- View and update branding/business/deployment settings.
- Manage map marker images for Network Settings Map OLT and NAP markers under Images -> OLT/NAP.
- Manage customer-information avatar moods for neutral, happy, sad, angry, offline, support, maintenance, warning, and resolved account contexts, with separate Male and Female upload slots.
- Manage the customer avatar emotion guide under Avatar -> Settings. The guide stores score thresholds and module signal weights used by shared customer mood resolution.
- Manage OPENAI settings, including masked API key status, selected model, selected reasoning effort, model pricing reference, and a live Responses API test.
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
- Branding/business settings are still in-memory in the first shell.
- Location Management records, deleted preload markers, Network Settings map marker images, avatar images, avatar emotion guide settings, and OPENAI settings persist to `SYSTEM_SETTINGS_DATA_PATH` (`/app/data/system_settings.json` in Docker Compose) through the `threejmain_api_data` named volume.
- Map image endpoints are module-owned under `/api/system-settings/map-images`; accepted uploads are PNG, JPG/JPEG, and WebP images up to 512 KB. `GET /api/system-settings/map-images` returns upload guidelines, target metadata, and any saved marker image data URLs. `PUT/DELETE /api/system-settings/map-images/{target_id}` manages the `olt` and `nap` marker images used by Network Settings -> Map.
- Avatar endpoints are module-owned under `/api/system-settings/avatars`; accepted uploads are PNG, JPG/JPEG, WebP, and GIF images up to 1 MB.
- Gender-specific avatar endpoints are `PUT/DELETE /api/system-settings/avatars/{gender_id}/{emotion_id}` where `gender_id` is `male` or `female`. The older `PUT/DELETE /api/system-settings/avatars/{emotion_id}` route remains as male-slot compatibility.
- `PATCH /api/system-settings/avatar-emotion-settings` updates the reusable scoring thresholds/weights returned by `GET /api/system-settings/avatars`.
- Shared reusable frontend code lives in `system-settings/web/avatarEmotion.js` and `system-settings/web/CustomerEmotionAvatar.jsx`. Customer-facing modules can import `CustomerEmotionAvatar` or `customerAvatarViewModel` to display the configured avatar and current behavior score.
- OPENAI endpoints are `GET/PATCH /api/system-settings/openai` for configuration and `POST /api/system-settings/openai/test` for a live Responses API test. API keys are never returned in full to the frontend. The test request sends `reasoning: {"effort": <selected effort>}` for the selected model, limited to that model's supported efforts.
- Access endpoints are under `/api/system-settings/access`. System-login administration was moved here from Account Admin to match the old `/home/threejmon` System Settings -> Access pattern.
- Access data persists to `SYSTEM_SETTINGS_DATA_PATH` in this first shell. It is not yet wired into app-shell login/session enforcement; app-shell still uses the existing single-admin login until a shared auth integration pass updates the shell.
- Location endpoints are module-owned under `/api/system-settings/locations` with `/api/locations` compatibility routes for workflows copied from 3JCentralPisowifi. Create, edit, delete, bulk delete, and customer-created minimal location records are persisted.
- `PATCH /api/system-settings/locations/{location_id}` updates saved location metadata.
- `POST /api/system-settings/locations/bulk-delete` removes selected location ids and has `/api/locations/bulk-delete` compatibility.
- Customer Profiling uses the exported `ensure_location_record` helper to link or create minimal location records during customer create/update.
