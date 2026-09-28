# System Settings

System Settings owns operator-facing configuration for the ISP management shell.

## Scope

- Branding and business profile fields, including company logo and browser page logo uploads copied from the old System Settings -> General flow. Logo uploads stage a pending preview and apply to the sidebar/favicon only after Save Settings.
- Location Management for manually created reusable site addresses, duplicate-safe multi-barangay creation, and an interactive latitude/longitude map picker
- Avatar mood uploads for customer-information screens, separated by Male/Female customer avatar slots
- Avatar emotion scoring guide for customer-facing module behavior badges
- OPENAI settings for API key storage, model and reasoning-effort selection, model pricing reference, and live API testing
- A2P Messaging settings for Smart Messaging Suite API credentials, endpoint paths, sender IDs, credit checks, test SMS, and local message logs
- Backup tab for configuration backup/restore and full system backup/restore of supported persistent app data
- Access tab for system-login Auth Settings, Permissions, Roles, and Users
- Graphify tab for viewing the host-generated development knowledge graph, architecture report, graph freshness, and AI workflow commands
- Maps tab for shared map tile providers grouped by vendor/type tabs, default provider selection, provider max zoom, attribution, optional public API key/token values, and Google Map Tiles session metadata used by Network Settings and Customer Profiling map surfaces
- Images tab for Network Settings OLT, NAP, PLC Splitter 1x8, and PLC Splitter 1x16 image assets
- System port registry viewer with separate Production and Staging labels for threejmain web/API ports
- System Update for reviewing recent production releases, viewing feature/function summaries, running deployment preflight checks, and manually updating or downgrading production

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
- Branding endpoints:
  - `GET /api/system-settings/settings`
  - `PATCH /api/system-settings/settings`
  - `PUT /api/system-settings/branding/company-logo`
  - `PUT /api/system-settings/branding/browser-logo`
  - Public shell routes: `GET /api/public/branding`, `GET /api/public/branding/company-logo`, `GET /api/public/branding/browser-logo`
- Avatar endpoints:
  - `GET /api/system-settings/avatars`
  - `PATCH /api/system-settings/avatar-emotion-settings`
  - `PUT /api/system-settings/avatars/{gender_id}/{emotion_id}`
  - `DELETE /api/system-settings/avatars/{gender_id}/{emotion_id}`
  - `PUT /api/system-settings/avatars/{emotion_id}`
  - `DELETE /api/system-settings/avatars/{emotion_id}`
- Location endpoints:
  - `GET /api/system-settings/locations`
  - `POST /api/system-settings/locations`
  - `POST /api/system-settings/locations/bulk-barangays`
  - `POST /api/system-settings/locations/bulk-delete`
  - `PATCH /api/system-settings/locations/{location_id}`
  - `DELETE /api/system-settings/locations/{location_id}`
  - `GET /api/system-settings/map-places/search`
  - `GET /api/system-settings/map-places/landmarks`
- OPENAI endpoints:
  - `GET /api/system-settings/openai`
  - `PATCH /api/system-settings/openai`
  - `POST /api/system-settings/openai/test`
- A2P Messaging endpoints:
  - `GET /api/system-settings/a2p-messaging`
  - `PATCH /api/system-settings/a2p-messaging`
  - `POST /api/system-settings/a2p-messaging/check-credits`
  - `POST /api/system-settings/a2p-messaging/test-send`
  - `GET /api/system-settings/a2p-messaging/messages`
- App-shell notification endpoints:
  - `GET /api/admin/notifications`
  - `POST /api/admin/notifications/read-all`
  - `POST /api/admin/notifications/{notification_id}/read`
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
- Backup endpoints:
  - `GET /api/system-settings/backups`
  - `GET /api/system-settings/backups/configuration`
  - `GET /api/system-settings/backups/full`
  - `POST /api/system-settings/backups/restore`
- System Update endpoints:
  - `GET /api/system-settings/deployments`
  - `GET /api/system-settings/deployments/commits/{selected_commit}`
  - `POST /api/system-settings/deployments/preflight`
  - `POST /api/system-settings/deployments/deploy`
- Graphify endpoints:
  - `GET /api/system-settings/graphify`
  - `POST /api/system-settings/graphify/artifact-tickets/{kind}`
  - `GET /api/system-settings/graphify/graph`
  - `GET /api/system-settings/graphify/report`
- Map provider endpoints:
  - `GET /api/system-settings/map-providers`
  - `PATCH /api/system-settings/map-providers`
  - `GET /api/system/map-providers`
  - `PATCH /api/system/map-providers`
- Compatibility endpoints retained:
  - `/api/system/settings`
  - `/api/system/ports`
  - `/api/locations`
  - `/api/locations/search`
  - `/api/locations/bulk-barangays`
  - `/api/locations/bulk-delete`
  - `/api/locations/{location_id}`

## Integration Notes

The app-shell configures this module with shared auth, audit logging, the shared settings store, and the port registry provider. The Ports tab lists threejmain Production ports (`8180` web, `8100` API), threejmain Staging ports (`8280` web, `8200` API), their internal PostgreSQL container ports, and existing 3JCentralPisowifi reservations.
Location Management is the single persisted manual location catalog for the system. Existing Customer Profiling addresses are backfilled into reusable manual records and linked to their customers by `locationId`; future customer saves link a selected record or create a manual record from the entered address. The table does not expose internal source labels because every visible location follows the same editable manual workflow. Add and Edit do not ask for a separate Location Name: the barangay is the canonical name and the API derives the address label from barangay, municipality, and province. Add Location opens one dialog where the operator chooses Single Location or Multiple Barangays. Multiple Barangays accepts up to 500 names in one request, creates one reusable location per unique municipality/barangay, and reports existing or repeated names as skipped instead of failing the batch. The multiple-entry mode reads the Customer Profiling location reference endpoint to auto-fill known barangays for a selected province and municipality, while custom one-per-line, comma-separated, or semicolon-separated lists remain supported when the reference catalog has no entries. Operators can type latitude/longitude or use the single-location map picker to search Philippine places, click, pan, and zoom to an exact point. On Edit, the picker reuses saved coordinates; when they are missing it resolves the barangay and opens the pin there. Nearby landmark overlays are grouped into checkable categories and can be refreshed around the current map center. Place lookup is a non-persisting map aid; saving still creates a manual location only. Nominatim catalog creation and automatic preloaded creation remain disabled; the retained compatibility location search route returns `410 Gone`. Legacy `PRELOADED`, `CUSTOMER_PROFILING`, and `NOMINATIM` rows are removed when the location store loads.
Branding/business/deployment settings, saved company/browser logo assets, manual Location records, Network Settings image assets, shared map provider settings, avatar images, avatar emotion guide settings, OPENAI settings, and A2P Messaging settings/logs are written to `SYSTEM_SETTINGS_DATA_PATH` (`/app/data/system_settings.json` in Docker Compose) so they survive API container restarts and rebuilds through the `threejmain_api_data` named volume. Company logo uploads accept PNG, JPG/JPEG, WebP, and GIF up to 5 MB; browser page logo uploads accept PNG, JPG/JPEG, WebP, GIF, and ICO up to 2 MB. Network Settings image assets accept PNG, JPG/JPEG, and WebP with a 512 KB maximum per image; avatar formats are PNG, JPG/JPEG, WebP, and GIF with a 1 MB maximum per image. Long-term production storage should still move to shared PostgreSQL and file/object storage before production use.
Reusable frontend avatar behavior code lives in `web/avatarEmotion.js` and `web/CustomerEmotionAvatar.jsx`. Customer-facing modules can import the component or resolver to display the current avatar, gender slot, mood score, and emotion label from the shared Avatar settings.
OPENAI settings are stored in the same `SYSTEM_SETTINGS_DATA_PATH` file. The API returns only masked key metadata to the frontend, stores the selected model, selected reasoning effort, and optional organization/project ids, exposes current model pricing metadata, and tests connectivity through the OpenAI Responses API.
A2P Messaging settings are stored in the same `SYSTEM_SETTINGS_DATA_PATH` file. The API returns only masked API key/password metadata to the frontend, sends Smart Messaging Suite test SMS requests through the saved configuration, stores local message logs, and exposes generated success/failure notifications to the shared top-nav bell through `/api/admin/notifications`.
Access settings are also stored in `SYSTEM_SETTINGS_DATA_PATH` for this shell. The Access tab mirrors the old `/home/threejmon` System Settings -> Access surface: Auth Settings, Permissions, Roles, and Users. Role and user records are in-memory/persisted JSON for now, and app-shell login now accepts Access users while keeping the legacy admin fallback. The first Tech Portal pass seeds Tech Portal permissions, a built-in `technician` role, and temporary test user `tech` / `tech12345`.
Graphify is copied from the old `/opt/threejnotif` System Settings -> Graphify pattern but adapted for this React/FastAPI app. The API reads `THREEJMAIN_GRAPHIFY_OUT_DIR` (Docker Compose sets `/graphify-out`) and serves only allowlisted `graph.html` and `GRAPH_REPORT.md` artifacts through authenticated routes. The frontend requests a short-lived artifact ticket before opening those routes because this app uses bearer tokens instead of session cookies. The app never runs Graphify commands; refresh from the host with `graphify extract . --code-only --max-workers 2`, `graphify cluster-only . --no-label`, or `graphify update .`.
Backup downloads are JSON files. Configuration backups include app-shell branding/business/deployment settings plus persisted System Settings and Network Settings data, including MikroTik API routers and SNMP OLT credentials for restore. Full backups add supported PostgreSQL application tables such as Customer Profiling. Backup files can contain secrets and should be stored securely.
System Update replaces the old Runtime tab. It shows the installed and latest production versions, deployment readiness, recent `master` releases, update/downgrade actions, and deployment progress. Each release has a View action containing only plain-language feature and workflow summaries; technical filenames, diffs, and code statistics are not exposed. `scripts/production_deploy_control_worker.sh` refreshes release summaries, performs host-level preflight checks, and reruns preflight automatically before every deployment.
