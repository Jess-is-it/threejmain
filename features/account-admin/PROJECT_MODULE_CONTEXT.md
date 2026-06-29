# Customer Network Module Context

This is the module-local source of truth for the Customer Network implementation. Keep ordinary module progress here instead of editing the root `Project_Context.md`.

## Module Folder

The implementation still uses the existing module folder for compatibility:

```text
account-admin/
  api/account_admin/__init__.py
  api/account_admin/router.py
  web/AccountAdminPage.jsx
  web/accountAdmin.css
  README.md
  module.json
  PROJECT_MODULE_CONTEXT.md
```

## Current Scope

Operator-facing name: Customer Network.

Customer Network manages customer-level network service configuration. It ties together Customer Profiling records, Service module accounts/orders, and Network Settings MikroTik PPPoE discovery.

Current Phase 1 UI is intentionally table-first:

- One Customer Account row is created for every visible Customer Profile.
- The Customer Accounts table is the master access summary for each customer after a Customer Profile exists.
- Customer Accounts now summarizes Internet/PPPoE access, Hotspot Access eligibility/sync readiness, future IPTV Access state, latest Ticketing action, and overall account health.
- Search, filter toggle, and tabs follow the Customer Profiling table pattern.
- Customer Accounts tabs are limited to `Active` and `Inactive`, with badge counts.
- Account groupings such as `Needs Action`, `With Internet`, `With Hotspot`, `With IPTV`, and `No Access` are Access filter options instead of tabs.
- Customer Accounts filters include Access, Customer Status, Internet Access, Hotspot Access, IPTV Access, and PPPoE Status.
- Ticket count and latest ticket details are read from the Ticketing module.
- Latest ticket Category, Status, Priority, and ticket-driven Account Admin action hints are shown in the Customer Accounts table. `INSTALLATION` tickets currently expose the intended `Create PPPoE Account` action hint for the next provisioning step.
- Internet Access summarizes PPPoE username/status, router, assigned IP, Service Account plan, and action state.
- Hotspot Access summary is derived from active Service Accounts, enabled customer mobile contacts, and Pisowifi sync settings.
- IPTV Access is a future-ready summary contract. It detects IPTV-like Service Account/Order data when present, but no IPTV provisioning controls or live integration are implemented yet.
- The temporary PPPoE/ONU mapping API still reads MikroTik PPPoE accounts and OLT ONUs from Network Settings, but it is no longer shown as a Customer Accounts tab.
- PPPoE-to-ONU matching is conservative but now accounts for observed device behavior: captured ONUs are first deduplicated by physical OLT/PON/ONU identity, exact PPPoE caller ID/MAC to ONU MAC evidence is matched first, same-OUI low-byte proximity matches use a maximum tail delta of 8 with mutual-best one-to-one assignment, and metadata fallback is used only when ONU identifiers appear in PPPoE text fields.
- The PPPoE/ONU mapping API also attaches one temporary sample dummy customer profile to the first matched PPPoE/ONU pair so the intended customer-profile binding shape can be reviewed without changing Customer Profiling data.
- `Hotspot Access` is a separate Account Admin view for syncing monthly subscriber eligibility to the Pisowifi captive portal. It derives subscriber rows from visible Customer Profiles plus active Service Accounts, supports primary/alternate/secondary mobile contacts, and signs outbound sync calls to Pisowifi. Sync All sends `sync_mode: FULL` so Pisowifi disables subscribers/contacts missing from the exported list; single-row/contact saves send `sync_mode: PARTIAL`.
- Service Account and Installation Order columns are hidden from the current Customer Accounts table.
- Network configuration forms, save buttons, MikroTik refresh buttons, PPPoE binding controls, and review-only controls are hidden for this step.

System-login users, roles, permissions, auth settings, and password reset controls remain in `system-settings/` under the Access tab.

## API

FastAPI package: `features/account-admin/api/account_admin`

API prefix: `/api/account-admin`

Routes:

- `GET /api/account-admin/health`
- `GET /api/account-admin/meta`
- `GET /api/account-admin/overview`
- `GET /api/account-admin/customer-accounts`
- `GET /api/account-admin/customer-accounts/{customer_id}`
- `GET /api/account-admin/pppoe-onu-mapping`
- `GET /api/account-admin/hotspot-access`
- `PATCH /api/account-admin/hotspot-access/settings`
- `POST /api/account-admin/hotspot-access/test`
- `PATCH /api/account-admin/hotspot-access/subscribers/{customer_id}/contacts`
- `POST /api/account-admin/hotspot-access/sync`
- `POST /api/account-admin/hotspot-access/subscribers/{customer_id}/sync`

Legacy system-login `/api/account-admin/accounts` routes return `410 Gone`.

## Frontend

Frontend entry: `features/account-admin/web/AccountAdminPage.jsx`

Styles: `features/account-admin/web/accountAdmin.css`

The page shows:

- A Customer Accounts table.
- Header search copied from Customer Profiling behavior: debounced typing, Enter submit, and clear button.
- Collapsible filters for Access, Customer Status, Internet Access, Hotspot Access, IPTV Access, and PPPoE Status.
- In-table tabs for Active and Inactive customer accounts with count badges.
- Customer Accounts columns for Customer, Internet Access, Hotspot Access, IPTV Access, Tickets / Action, and Account Health.
- A top-level view switch between Customer Accounts, Internet Access, Hotspot Access, and IPTV Access. Internet/IPTV currently reuse the Customer Accounts table with the matching Access filter applied.
- Hotspot Access settings for Pisowifi API base URL, API key, API secret, and enable/disable state.
- Hotspot Access subscriber table showing active monthly subscribers, Service Account/plan, synced contact numbers, contact edit actions, and Sync actions.
- Contact edit modal supports multiple allowed contact numbers per subscriber. One enabled contact number equals one captive portal device after Pisowifi SMS verification.
- Recent Hotspot Access sync logs display result chips for sync mode, exported subscriber/contact counts, cleanup counts, and revoked monthly sessions so operators can verify full-sync impact.

## Local Data Model

Module-local `customer_network_records` are keyed by `customerId`, but current UI only displays account-table fields.

Important fields:

- `lifecycleStatus`
- `provisioningStatus`
- `desiredPppoeUsername`
- `pppoeProfile`
- `pppoePasswordSet`
- `wifiSsid`
- `wifiPasswordSet`
- `cpeType`
- `cpeIdentifier`
- `onuId`
- `routerId`
- `routerName`
- `bandwidthProfile`
- `ipMode`
- `staticIp`
- `vlanId`
- `pppoeBinding`
- `provisioningRequests`
- `notes`
- computed `accessSummary.internetAccess`
- computed `accessSummary.hotspotAccess`
- computed `accessSummary.iptvAccess`
- computed `accessSummary.overallStatus`
- computed `accessSummary.actionRequired`

Passwords are not returned by the API. Phase 1 only records whether a password change was set and when it was updated.

## Dependencies

- `customer-profiling`: customer identity source.
- `service`: Service Accounts and Service Orders.
- `ticketing`: customer ticket assignments and latest ticket summaries.
- `network-settings`: MikroTik PPPoE discovery and captured OLT ONU inventory source.
- `system-settings`: system-login Access controls remain there.
- `3JCentralPisowifi`: receives signed monthly subscriber syncs and performs captive portal login/device authorization.

## Integration Notes

- The module remains routed as `/account-admin` and `/api/account-admin` until an integration pass renames shared navigation/routes.
- `module.json` uses the Customer Network label for future app-shell metadata consumers.
- App-shell hardcoded module metadata may still show Account Admin until Integration Codex updates shared navigation.
- Hotspot Access request signing uses `X-3J-Integration-Key`, `X-3J-Timestamp`, `X-3J-Signature`, and `X-3J-Idempotency-Key`. The signature is HMAC-SHA256 over `<timestamp>.<raw body>`.
- The signed payload includes `sync_mode`. Use `FULL` only for complete Account Admin exports; use `PARTIAL` for one-subscriber/contact saves so Pisowifi does not disable unrelated monthly access.

## Known Gaps

- In-memory data resets on API restart.
- Activation readiness is derived because Service does not yet have a dedicated activation order type/status.
- Temporary sample customer profile in the PPPoE/ONU mapping response is not persisted to Customer Profiling.
- PPPoE/ONU matching is only as complete as captured ONU MAC/identifier data from OLT SNMP.
- Same-OUI proximity matching is intentionally limited to high-confidence low-byte deltas and mutual-best candidates; duplicate captured rows for the same physical ONU are merged before ambiguity checks.
- Network configuration editing, PPPoE binding, live PPPoE create/update/disable, WiFi/CPE writes, and router profile changes are future steps.
- PPPoE creation is not implemented yet. The next step should allow create only from an eligible `INSTALLATION` ticket, resolve the customer's System Settings `locationId`/address to a MikroTik router through Network Settings location bindings, then call the live RouterOS provisioning adapter.
- Durable PostgreSQL tables and audit-grade sync history are future work.
- Hotspot Access settings/contact overrides currently persist to the configured JSON state file. Docker deployments should set `ACCOUNT_ADMIN_HOTSPOT_STATE_PATH=/app/data/account_admin_hotspot.json` so the file is stored in the API data volume. Move this to a durable module database table if 3J Main later standardizes module persistence beyond Customer Profiling.
- IPTV Access is currently summary-only and depends on future Service/IPTV data contracts before provisioning, device binding, or live IPTV account sync can be added.
