# Network Settings Module Context

## Purpose

Network Settings is the ISP network source-of-truth module. The first functional scope manages device records, live MikroTik PPPoE account discovery, OLTs, generated/editable PON ports under OLTs, captured ONU inventory, NAP boxes assigned to PONs, and FBT records assigned to NAP boxes.

The module is intended to connect customer installation and service lifecycle work to the actual access network path.

## Current Status

- Status from `module.json`: `functional-shell`
- Planned app-shell route: `/network-settings`
- Planned API prefix: `/api/network-settings`
- Frontend entry: `network-settings/web/NetworkSettingsPage.jsx`
- API entry: `network-settings/api/network_settings/router.py`
- The module is wired into `app-shell/` navigation, API router registration, Docker copy paths, Vite allowlist, and module metrics.
- Current implementation uses module-local JSON persistence on `/app/data/network_settings.json` when the shared API data volume is available. Shared PostgreSQL persistence remains future work.
- Network Settings JSON persistence now writes to a temp file and atomically replaces `/app/data/network_settings.json` to avoid truncated data files during shared server rebuilds/restarts.
- SNMP capture history is persisted as compact per-device history instead of storing every walked interface row. This keeps small CRUD saves, including NAP box saves, from rewriting hundreds of MB of capture details. Manual capture responses still return current-run details; persisted history keeps counts, system details, reconciliation, and bounded candidate previews.
- The PPPoE Accounts page is now a live read-only RouterOS API discovery surface for saved MikroTik API devices; mapping and provisioning are not implemented yet.

## Research Summary

Enterprise ISP systems typically separate:

- customer identity and service orders
- resource inventory and topology
- resource activation/provisioning
- trouble ticket assurance
- audit/change history

Network Settings should follow that split while remaining module-local until integration.

Relevant research anchors:

- TM Forum resource inventory and resource activation APIs imply a separation between resource records and activation/configuration actions.
- TM Forum service order and trouble ticket models show that provisioning should be linked to service orders and tickets through related entities, state, severity, priority, notes, and notifications.
- Broadband Forum xPON YANG work treats OLT/ONU/PON management as structured data models covering configuration, fault, performance, PON link resources, ONU activation, and authentication.
- MikroTik RouterOS PPPoE/PPP AAA docs show the need to model PPP profiles, local user secrets, optional RADIUS, static/dynamic sessions, IP pools, and profile overrides.
- NetBox-style source-of-truth design suggests modeling desired network state first, including devices, IPAM, circuits, cabling, and topology, before applying automation.

## Planned Sub-Navigation

- Overview
- MikroTik API
- PPPoE Accounts
- OLT SNMP
- Map
- OLT & PON
- ONUs
- NAP Boxes
- FBT

## Planned CRUD Scope

### Access Network Inventory

- Device records support MikroTik and OLT endpoints, split by API and SNMP access method, with management host, API username for MikroTik API records, hidden secret flags, vendor/model captured later where available, non-secret profile names, status, and notes. The device modal no longer asks operators for Site / Location; the API keeps the internal default for compatibility. During the first SNMP test phase, devices are not linked to OLT inventory records.
- The old combined Devices navigation page has been removed. MikroTik API shows only MikroTik API device records. OLT SNMP shows only OLT SNMP device records.
- The device create/edit modal now starts with access-method button choices, then radio-style device type selection. Connection fields remain hidden until both access and device type are selected. The page-specific Settings screens preselect and limit the relevant access/type. Status, vendor, model, API profile, and notes are not operator-entered in the device modal.
- Saving an API MikroTik device requires a RouterOS API username/password and performs an authenticated RouterOS API login test against the configured API host/port before the record is accepted. The login test tries current RouterOS name/password API login first and falls back to legacy challenge-response login for older RouterOS releases. Saved API passwords are persisted server-side for staging continuity, omitted from normal API responses, and replaced only when edit mode submits a new password.
- MikroTik API now includes a location-binding row action. Operators can bind multiple System Settings Location Management records to one MikroTik router so Customer Network can later auto-select the provisioning router from the customer location during INSTALLATION PPPoE account creation.
- The SNMP add-device form intentionally follows LibreNMS-style onboarding fields: hostname/IP, display name, SNMP version, optional v1/v2c community or v3 auth/privacy credentials, SNMP port, transport, port association mode, poller group, and force-add. Display name defaults to hostname/IP when omitted. Blank v1/v2c community means future polling should try configured `snmp.community` communities.
- API password, SNMP community, auth password, and crypto password are accepted by the API but omitted from normal device list/detail responses; responses expose only `hasApiPassword`, `hasSnmpCommunity`, `usesConfiguredSnmpCommunities`, `hasSnmpAuthPassword`, and `hasSnmpPrivacyPassword` booleans.
- SNMP OLT device records carry `READY_FOR_OLT_SNMP_AUTODETECT` metadata and have Capture plus OLT map-location actions in the OLT SNMP table. The OLT map-location action binds one System Settings location or manual latitude/longitude to the SNMP OLT device and its linked OLT inventory record so the OLT marker can display on the Map page. The binding modal groups latitude/longitude inputs and includes a Capture button that opens an inline OSM map; clicking the map writes the selected coordinates into the form.
- `POST /api/network-settings/devices/{device_id}/capture` runs a manual LibreNMS-style discovery pass for SNMP v1/v2c over UDP/UDP6. The first implementation uses a small stdlib SNMP client, fetches SNMPv2-MIB system identity, walks IF-MIB interface columns, stores capture history, infers PON candidates from PON-like interface names/descriptions, and infers ONU candidates from subscriber-side ONU/ONT/GEM/TCONT interface rows when the OLT exposes them through IF-MIB.
- The shared API startup calls `start_network_settings_poller()`. The poller checks for due SNMP devices every `NETWORK_SETTINGS_POLL_LOOP_SECONDS` seconds and runs the same capture/reconciliation path once `lastCapturedAt` is at least `pollIntervalSeconds` old. The default device poll interval is 300 seconds.
- Successful SNMP OLT captures update the device vendor/model from `sysDescr` or common enterprise OID prefixes, auto-create or update an OLT inventory record, create/update PON rows under it, and create/update captured ONU rows linked to OLT/PON where the PON assignment can be inferred. Reconciliation updates only captured/source metadata plus empty/default fields; it does not delete operator records or silently remove PONs that disappear from SNMP. PON optical module power is no longer read from SNMP capture because vendor support is inconsistent; operators maintain PON power/module readings manually from the OLT & PON page.
- VSOL-style PON/ONU interfaces are parsed with physical ports such as `EPON0/1` or `GPON0/1` treated as PON rows and child/subscriber interfaces such as `EPON0/1:1` or compact `GPON01ONU1` treated as ONU rows under their parent PON. The parser retires previously captured child-interface PON rows from the same source device when they have no NAP/ONU assignments, fixing earlier cases where ONU child interfaces inflated PON counts. For VSOL enterprise OID `1.3.6.1.4.1.37950`, capture also reads the interface-to-MAC table under `1.3.6.1.4.1.37950.1.1.5.10.3.2.1` and stores the learned child-interface MAC as ONU mapping evidence.
- Capture result summaries expose captured system identity without contact in the UI, interface count, inferred PON/ONU candidates, and OLT/PON/ONU reconciliation counts. ONU capture records serial number, MAC address, Rx/Tx optical power, distance, temperature, voltage, bias current, VLAN, service port, profile, and last-down reason when those values are exposed in generic SNMP interface text. For HS Fiber/HSGQ enterprise OID `1.3.6.1.4.1.50224`, capture also walks the EPON ONU info and ONU optical tables to fill ONU MAC address, receive power, transmit power, distance, temperature, voltage, and bias current. The ONUs page auto-refreshes every 15 seconds while open. SNMPv3 capture, additional vendor-specific OLT/ONU MIB OID mapping, guaranteed optical metrics across every vendor, and review-before-apply reconciliation remain future work.
- OLT records with vendor, model, management endpoint, site, firmware, status, default PON target count, and notes.
- OLT creation generates four default PON records unless another default PON count is supplied.
- Increasing an OLT default PON target creates missing PON rows; decreasing it does not silently delete existing PONs.
- PON port records are linked to OLTs with port number, technology, admin status, operational status, manually maintained module vendor/part/serial/Rx/Tx power/temperature/voltage/bias current, split ratio, VLAN/service tag, capacity, and notes. PON defaults are technology-aware: GPON/XGS-PON use `1:128` capacity 128, while EPON/OTHER use `1:64` capacity 64. SNMP capture applies these defaults when it updates captured PON rows. Generic captured labels such as `PON01` infer technology from the OLT/device identity when the model exposes it, such as HSGQ `G04L` as GPON, and persisted rows are normalized on load so older records do not keep stale capacity values.
- PON display labels are canonicalized as `PON01`, `PON02`, etc. Captured interface labels such as `EPON0/1` or `GPON0/1` are retained as source metadata but are not shown as the operator-facing PON name. The NAP Assigned PON selector displays `Vendor/OLT/PONxx`, for example `HSGQ/RomaBatu/PON01`.
- PON delete is allowed only when no NAP boxes are assigned to the PON.
- ONU rows are captured inventory records linked to OLT and PON with ONU id, serial number, MAC address, admin/oper status, online/offline status, optical power, distance, temperature, voltage, bias current, VLAN, service port, profile, last-down reason, source interface metadata, and last capture timestamp when available from the OLT.
- NAP box records are assigned to PON ports with a NAP name that is unique only within the selected PON, searchable barangay selection, coordinates, status, and notes. The same NAP name may be reused on a different PON. The NAP add/edit modal asks for OLT first, then filters PON choices into radio cards. New NAP saves can keep the modal open with an "add another" checkbox; after a successful save the form clears all NAP fields while retaining the selected OLT and PON. Barangay suggestions are lazy-loaded from System Settings locations when the NAP modal opens, and the Barangay field is shown after Latitude/Longitude. The old free-text Location field is no longer shown in the NAP add/edit modal. Splitter ratio is limited to radio choices `1x8` and `1x16` in the UI and validated server-side as `1:8` or `1:16`. NAP port capacity remains an internal/default backend value and is no longer exposed in the NAP add/edit modal.
- The NAP Boxes page groups records as collapsible OLT rows, then collapsible PON rows, then NAP child rows. It has OLT, PON, status, and search filters, and child NAP rows keep Customer Profiling-style edit/delete actions.
- NAP delete is allowed only when no FBT records are assigned to the NAP.
- FBT records are assigned to NAP boxes with port number, port capacity, status, location hint, and notes.
- The Map page is a full-bleed Network Settings page under the OLT sidebar group. It displays OLT and NAP markers over viewport-aware OpenStreetMap tiles, links NAPs to their OLT, supports search, OLT/type filters, zoom buttons, mouse-wheel zoom, and mouse panning. Tiles are recalculated from the current pan/zoom so panning reveals surrounding map tiles instead of blank canvas. Marker placement uses latitude/longitude when present and falls back to a stable topology layout so records without coordinates still render. NAP coordinates saved in either decimal or DMS format, such as `17°31'49.77"N`, are parsed for map placement. Custom OLT/NAP marker images are read from System Settings -> Images.
- Topology, PPPoE provisioning queue, IP/VLAN planning, and network events remain planned future scope.

### MikroTik And PPPoE

- MikroTik router records with identity, management endpoint metadata, role, API readiness, PPPoE server interface, and status.
- `GET /api/network-settings/pppoe-accounts` opens RouterOS API sessions to saved MikroTik API devices, reads `/ppp/secret/print` and `/ppp/active/print`, merges rows by username, and returns read-only live PPPoE account/session rows with router, status, caller ID/MAC, assigned IP, profile, uptime, last caller ID, logout, and disconnect reason.
- `PATCH /api/network-settings/devices/{device_id}/location-bindings` stores the System Settings location ids/snapshots bound to a MikroTik API router. `GET /api/network-settings/router-location-bindings` lists all MikroTik router bindings, and `GET /api/network-settings/routers/by-location` resolves a customer location id/name/barangay/municipality/province to matching routers for future provisioning.
- `PATCH /api/network-settings/devices/{device_id}/olt-location` stores one OLT map location for an SNMP OLT device, validates latitude/longitude, and creates or updates the linked OLT inventory row used by the Map page.
- The PPPoE Accounts page is grouped under MikroTik in the shared sidebar, includes KPI cards, router/status/profile filters, search, show-entries, sortable columns, pagination, manual refresh, per-device error warnings, and 30-second auto-refresh while open.
- IP pool records with CIDR/range, router, utilization, and operational status.
- VLAN profile records with service-tag policy and applicability.
- PPPoE profile records mapped to Service Catalog plans, speed/rate policy, address pool, DNS, and accounting behavior.
- PPPoE account records linked to Customer Profiling, Service Account, Service Order, Ticketing ticket, MikroTik router, and PPP profile.

### Provisioning And Assurance

- Provisioning jobs for create/update/disable/re-enable PPPoE account, apply plan profile, move service path, rollback failed action, and reconcile desired/live state.
- Network events for failed provisioning, router/OLT reachability, capacity warnings, optical warnings, and customer-affecting alarms.
- Audit log hooks for every network inventory edit and provisioning action.

## Main Workflows

### Installation Workflow

1. Customer Profiling creates or maintains the customer.
2. Service creates the Service Account and Service Order.
3. Service auto-creates a Ticketing ticket for the installation.
4. Ticketing collects field installation details: ONU/CPE, NAP box, NAP port, OLT/PON, router, and planned PPP profile.
5. Network Settings creates a provisioning job from the completed ticket requirements.
6. The job creates or updates the PPPoE account and network attachment.
7. Network Settings records the result and updates Ticketing notes/status context.
8. Service Account can then carry the active network attachment for Billing and support visibility.

### Support/Trouble Workflow

- Ticketing can link a ticket to a Service Account and Network Settings path.
- Network Settings should expose customer service path: router, PPPoE account, OLT, PON port, NAP box, and recent events.
- Network events can suggest or create Ticketing tickets later, after integration approval.

### Billing/Service Lifecycle Workflow

- Service Order Plan Upgrade/Downgrade should update PPPoE profile/rate policy.
- Billing or Service suspension should request PPPoE disable or suspended profile.
- Reconnection should restore active PPPoE access and validate authentication.
- Relocation should update topology, NAP attachment, and provisioning path.
- Equipment Replacement should update ONU/CPE and topology while keeping Service Account continuity.

## Integration Dependencies

- Customer Profiling: customer identity, location, and customer snapshot.
- Service: Service Account, Service Order, catalog plan, service reference, and lifecycle state.
- Ticketing: installation/provisioning ticket source and ticket notes/status updates.
- Billing: future billing status or suspension/reconnection trigger.
- Inventory: ONU/CPE, routers, cables, splitters, and installation material assignment.
- System Settings: reusable locations, future network credential profiles, and global integration settings.
- Logs: audit output for edits and provisioning actions.
- Account Admin: role boundaries for NOC, installer, network admin, and read-only access.
- Customer Service Management: customer interaction follow-ups for network-affecting events.
- Point of Sale: sold equipment that may become Inventory assets before network assignment.

## Integration Notes

- Frontend import: `network-settings/web/NetworkSettingsPage.jsx`.
- Backend import: `network-settings/api/network_settings/router.py`.
- API router export: `router`.
- Metrics export: `network_settings_metrics`.
- Configure hook: `configure_network_settings(current_admin, audit_logger)`.
- App-shell parent route: `/network-settings`.
- App-shell subroutes: `/network-settings/mikrotik/settings`, `/network-settings/pppoe-accounts`, `/network-settings/olt/settings`, `/network-settings/map`, `/network-settings/olts`, `/network-settings/onus`, `/network-settings/nap-boxes`, `/network-settings/fbts`.
- Shared sidebar grouping: MikroTik API and PPPoE Accounts live under a MikroTik subgroup; OLT SNMP, Map, OLT & PON, ONUs, NAP Boxes, and FBT live under an OLT subgroup.
- The frontend renders these as separate route pages, not as an internal tabbed workspace. The parent `/network-settings` route remains the overview.
- There is no standalone Devices route in the current sidebar. The legacy `/network-settings/devices` path loads MikroTik API for bookmark compatibility.
- CRUD tables and create/edit modals use the same general UI pattern as Customer Profiling: card table headers, compact search input, icon-only create/refresh buttons, table row action buttons, and modal forms.
- The OLT & PON page combines OLT and PON management in one table: OLT rows expand to show their PON CRUD table, manually entered PON power module details, and per-OLT PON add action. The top-level Add OLT action is hidden because OLT inventory is now expected to come from OLT SNMP capture.
- The ONUs page is a separate captured-inventory table and auto-refreshes while open so operators do not need to manually reload after a capture. It includes KPI cards, ONUs-per-PON summary buttons, status/OLT/PON filters, and no poll column.
- The PPPoE Accounts page is a separate read-only RouterOS API discovery page for saved MikroTik devices. It does not create, edit, or delete PPP secrets yet.
- The Map page uses OpenStreetMap raster tiles. Wheel zoom anchors to the cursor, HD mode requests one higher native tile zoom when practical, and standard OSM tiles are capped at native z19 before any further digital zoom. The Map legend is interactive: operators can show/hide OLT markers, NAP markers, PON assignment lines, and marker detail labels.
- Network Settings row action buttons use Customer Profiling-style filled badge classes (`bg-*-lt text-* border-0`) so edit/delete backgrounds render consistently.
- Navigation label: `Network Settings`.
- Docker/Vite allowlists include `network-settings`.

## API Skeleton

Current endpoints:

- `GET /api/network-settings/health`
- `GET /api/network-settings/meta`
- `GET /api/network-settings/plan`
- `GET /api/network-settings/overview`
- `GET/POST/PATCH/DELETE /api/network-settings/devices`
- `PATCH /api/network-settings/devices/{device_id}/location-bindings`
- `PATCH /api/network-settings/devices/{device_id}/olt-location`
- `GET /api/network-settings/router-location-bindings`
- `GET /api/network-settings/routers/by-location`
- `GET /api/network-settings/devices/{device_id}/captures`
- `POST /api/network-settings/devices/{device_id}/capture`
- `GET /api/network-settings/pppoe-accounts`
- `GET/POST/PATCH/DELETE /api/network-settings/olts`
- `GET/POST /api/network-settings/olts/{olt_id}/pons`
- `GET /api/network-settings/pons`
- `PATCH/DELETE /api/network-settings/pons/{pon_id}`
- `PATCH /api/network-settings/pons/{pon_id}/power`
- `GET /api/network-settings/onus`
- `GET/POST/PATCH/DELETE /api/network-settings/nap-boxes`
- `GET/POST/PATCH/DELETE /api/network-settings/fbts`

## Known Risks And Boundaries

- On 2026-05-25 during a shared runtime rebuild, `/app/data/network_settings.json` was found truncated before device records. A corrupt backup was preserved in the API container data volume as `network_settings.corrupt-20260525T171553Z.json`, and a syntactically valid recovered JSON was written, but Network Settings currently loads zero saved devices from that runtime file. MikroTik/OLT device records need restoration from an external backup or re-entry in the UI.
- This module must not store plaintext device credentials or PPPoE passwords in regular API responses.
- Current device credential fields are stored in module-local server data when available and still must move to System Settings or another secure credential store with encryption before production.
- Live MikroTik or OLT changes require explicit adapter design, credential storage, retry/rollback behavior, and audit logging.
- The JSON persistence bridge is for staging continuity only; production needs shared PostgreSQL persistence and encrypted secret handling.
- Device discovery should not silently overwrite source-of-truth data. Reconciliation should show differences for operator review.
- The module no longer seeds sample OLT/PON/NAP/FBT/device records on API startup; first SNMP testing should begin by adding an OLT device in the SNMP tab.
- Network Settings should not own customer identity, service catalog, billing subscription, or ticket lifecycle; it should reference those records.
- Ticketing creates the work context; Network Settings executes or records network provisioning state.

## Next Recommended Work

1. Add PPPoE-to-ONU/customer mapping using MikroTik caller IDs, OLT ONU MAC/serial, and service/customer records.
2. Add PPP profile and PPPoE desired-state CRUD/provisioning actions after mapping is stable.
3. Add Ticketing-to-Network provisioning request contract after Ticketing installation fields are finalized.
4. Add Service Account network attachment fields.
5. Replace module-local JSON persistence with shared PostgreSQL persistence and encrypted device secrets.
