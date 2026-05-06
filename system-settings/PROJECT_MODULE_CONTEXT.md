# System Settings Module Context

## Purpose

System Settings manages shell configuration pages for branding, business profile, runtime paths, access reminders, reusable location records, and the system port registry.

## Current Status

- Status: `functional-shell`
- App-shell route: `/system-settings`
- API prefix: `/api/system-settings`
- Frontend entry: `system-settings/web/SystemSettingsPage.jsx`
- API entry: `system-settings/api/system_settings/router.py`

## Current Scope

- View and update branding/business/deployment settings.
- Manage reusable Location Management records with address, municipality, barangay, province, region, coordinates, geocoder source, and notes.
- Search geocoder suggestions through Nominatim-compatible `GEOCODER_SEARCH_URL` and manually enter location records when search is unavailable.
- View reserved ports used by the app and related 3JCentralPisowifi services.
- Keep compatibility API routes for `/api/system/settings`, `/api/system/ports`, and `/api/locations`.

## Integration Notes

- App-shell imports `SystemSettingsPage` and passes `refreshShell`.
- App-shell calls `configure_system_settings(current_admin, add_audit, settings, port_registry)`.
- Durable persistence is still deferred; settings and location records are in-memory in the first shell.
- Location endpoints are module-owned under `/api/system-settings/locations` with `/api/locations` compatibility routes for workflows copied from 3JCentralPisowifi.
