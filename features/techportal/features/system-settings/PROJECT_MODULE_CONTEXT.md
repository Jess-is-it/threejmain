# Tech Portal System Settings Context

## Purpose

System Settings is the portal-safe settings area for technician profile and device preferences. It must not expose the full admin System Settings surface.

## Current Status

- Status: `planned-shell`
- Parent feature: `features/techportal`
- Planned route: `/techportal/system-settings`
- API scope: future `/api/techportal/settings`
- Current implementation: documentation-only feature folder.

## Planned Scope

- Technician profile summary.
- Password/session preferences once shared access supports technician identities.
- Notification preferences.
- Device/app preferences.
- Map/provider preference if safe to expose.
- Future offline sync status and cache controls.
- Help and knowledge links.

## Dependencies

- System Settings for shared branding, maps, notifications, and access/session configuration.
- Account Admin or a future staff module for technician profile/team/skill records.
- Logs for settings-change activity.

## Boundaries

- This is not the full admin System Settings module.
- Do not expose global configuration, secrets, device credentials, API keys, or admin access controls.
- Offline cache controls must not reveal or retain sensitive customer data longer than policy allows.
