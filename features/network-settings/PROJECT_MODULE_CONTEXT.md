# Network Settings Module Context

## Purpose

Network Settings is the ISP network source-of-truth module. The first functional scope manages device records, live MikroTik PPPoE account discovery, OLTs, generated/editable PON ports under OLTs, captured ONU inventory, NAP boxes assigned to PONs, PLC/LCP/FBT splitter catalog records, fiber optic loss profiles, and network topology.

The module is intended to connect customer installation and service lifecycle work to the actual access network path.

## Current Status

- Status from `module.json`: `functional-shell`
- Planned app-shell route: `/network-settings`
- Planned API prefix: `/api/network-settings`
- Frontend entry: `features/network-settings/web/NetworkSettingsPage.jsx`
- API entry: `features/network-settings/api/network_settings/router.py`
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
- Mapping
- Serviceability Check
- Topology
- MikroTik API
- PPPoE Accounts
- OLT SNMP
- OLT & PON
- ONUs
- NAP Boxes
- Insertion Loss / Splitters
- Insertion Loss / Fiber Optic

## Planned CRUD Scope

### Access Network Inventory

- Device records support MikroTik and OLT endpoints, split by API and SNMP access method, with management host, API username for MikroTik API records, hidden secret flags, vendor/model captured later where available, non-secret profile names, status, and notes. The device modal no longer asks operators for Site / Location; the API keeps the internal default for compatibility. During the first SNMP test phase, devices are not linked to OLT inventory records.
- The old combined Devices navigation page has been removed. MikroTik API shows only MikroTik API device records. OLT SNMP shows only OLT SNMP device records.
- The device create/edit modal now starts with access-method button choices, then radio-style device type selection. Connection fields remain hidden until both access and device type are selected. The page-specific Settings screens preselect and limit the relevant access/type. Status, vendor, model, API profile, and notes are not operator-entered in the device modal.
- Saving an API MikroTik device requires a RouterOS API username/password and performs an authenticated RouterOS API login test against the configured API host/port before the record is accepted. The login test tries current RouterOS name/password API login first and falls back to legacy challenge-response login for older RouterOS releases. Saved API passwords are persisted server-side for staging continuity and intentionally returned/displayed in the MikroTik API table and edit modal.
- MikroTik API now includes a location-binding row action. Operators can bind multiple System Settings Location Management records to one MikroTik router so Customer Network can later auto-select the provisioning router from the customer location during INSTALLATION PPPoE account creation.
- The SNMP add-device form intentionally follows LibreNMS-style onboarding fields: hostname/IP, display name, SNMP version, optional v1/v2c community or v3 auth/privacy credentials, SNMP port, transport, port association mode, poller group, and force-add. Display name defaults to hostname/IP when omitted. Blank v1/v2c community means future polling should try configured `snmp.community` communities.
- API password, SNMP community, auth password, and crypto password are accepted by the API. MikroTik API passwords are returned in device list/detail responses for operator visibility; SNMP community/auth/privacy passwords remain omitted and responses expose `hasSnmpCommunity`, `usesConfiguredSnmpCommunities`, `hasSnmpAuthPassword`, and `hasSnmpPrivacyPassword` booleans.
- SNMP OLT device records carry `READY_FOR_OLT_SNMP_AUTODETECT` metadata and have Capture plus OLT mapping-location actions in the OLT SNMP table. Operators can drag SNMP OLT table rows top-to-bottom to persist `displayOrder`; the linked OLT inventory rows mirror that order and Network Topology OLT tabs use it. The OLT mapping-location action binds one System Settings location or manual latitude/longitude to the SNMP OLT device and its linked OLT inventory record so the OLT marker can display on the Mapping page. The binding modal groups latitude/longitude inputs and includes a Capture button that opens an inline Web Mercator street map; clicking the map writes the selected coordinates into the form.
- `POST /api/network-settings/devices/{device_id}/capture` runs a manual LibreNMS-style discovery pass for SNMP v1/v2c over UDP/UDP6. The first implementation uses a small stdlib SNMP client, fetches SNMPv2-MIB system identity, walks IF-MIB interface columns, stores capture history, infers PON candidates from PON-like interface names/descriptions, and infers ONU candidates from subscriber-side ONU/ONT/GEM/TCONT interface rows when the OLT exposes them through IF-MIB.
- The shared API startup calls `start_network_settings_poller()`. The poller checks for due SNMP devices every `NETWORK_SETTINGS_POLL_LOOP_SECONDS` seconds and runs the same capture/reconciliation path once `lastCapturedAt` is at least `pollIntervalSeconds` old. The default device poll interval is 300 seconds.
- Successful SNMP OLT captures update the device vendor/model from `sysDescr` or common enterprise OID prefixes, auto-create or update an OLT inventory record, create/update PON rows under it, and create/update captured ONU rows linked to OLT/PON where the PON assignment can be inferred. Reconciliation updates only captured/source metadata plus empty/default fields; it does not delete operator records or silently remove PONs that disappear from SNMP. PON optical module power is no longer read from SNMP capture because vendor support is inconsistent; operators maintain PON power/module readings manually from the OLT & PON page.
- VSOL-style PON/ONU interfaces are parsed with physical ports such as `EPON0/1` or `GPON0/1` treated as PON rows and child/subscriber interfaces such as `EPON0/1:1` or compact `GPON01ONU1` treated as ONU rows under their parent PON. The parser retires previously captured child-interface PON rows from the same source device when they have no NAP/ONU assignments, fixing earlier cases where ONU child interfaces inflated PON counts. For VSOL enterprise OID `1.3.6.1.4.1.37950`, capture also reads the interface-to-MAC table under `1.3.6.1.4.1.37950.1.1.5.10.3.2.1` and stores the learned child-interface MAC as ONU mapping evidence.
- Capture result summaries expose captured system identity without contact in the UI, interface count, inferred PON/ONU candidates, and OLT/PON/ONU reconciliation counts. ONU capture records serial number, MAC address, Rx/Tx optical power, distance, temperature, voltage, bias current, VLAN, service port, profile, and last-down reason when those values are exposed in generic SNMP interface text. For HS Fiber/HSGQ enterprise OID `1.3.6.1.4.1.50224`, capture also walks the EPON ONU info and ONU optical tables to fill ONU MAC address, receive power, transmit power, distance, temperature, voltage, and bias current. The ONUs page auto-refreshes every 15 seconds while open. SNMPv3 capture, additional vendor-specific OLT/ONU MIB OID mapping, guaranteed optical metrics across every vendor, and review-before-apply reconciliation remain future work.
- OLT records with vendor, model, management endpoint, site, firmware, status, default PON target count, and notes.
- OLT creation generates four default PON records unless another default PON count is supplied.
- Increasing an OLT default PON target creates missing PON rows; decreasing it does not silently delete existing PONs.
- PON port records are linked to OLTs with port number, technology, admin status, operational status, PON color, manually maintained PON module brand and PON power in dBm, split ratio, VLAN/service tag, capacity, and notes. PON defaults are technology-aware: GPON/XGS-PON use `1:128` capacity 128, while EPON/OTHER use `1:64` capacity 64. PON color defaults are based on four stable families: `#20C997`, `#FCC419`, `#339AF0`, and `#CC5DE8`; PON01-PON04 use those exact colors and higher ports derive deterministic family variants. SNMP capture applies these defaults when it updates captured PON rows. Generic captured labels such as `PON01` infer technology from the OLT/device identity when the model exposes it, such as HSGQ `G04L` as GPON, and persisted rows are normalized on load so older records do not keep stale capacity/color values.
- PON display labels are canonicalized as `PON01`, `PON02`, etc. Captured interface labels such as `EPON0/1` or `GPON0/1` are retained as source metadata but are not shown as the operator-facing PON name. The NAP Assigned PON selector displays `Vendor/OLT/PONxx`, for example `HSGQ/RomaBatu/PON01`.
- PON delete is allowed only when no NAP boxes are assigned to the PON.
- ONU rows are captured inventory records linked to OLT and PON with ONU id, serial number, MAC address, admin/oper status, online/offline status, optical power, distance, temperature, voltage, bias current, VLAN, service port, profile, last-down reason, source interface metadata, and last capture timestamp when available from the OLT.
- NAP box records are assigned to PON ports with a NAP name that is unique only within the selected PON, searchable barangay selection, coordinates, status, and notes. The same NAP name may be reused on a different PON. The NAP add/edit modal asks for OLT first, then filters PON choices into radio cards. New NAP saves can keep the modal open with an "add another" checkbox; after a successful save the form clears all NAP fields while retaining the selected OLT and PON. Barangay suggestions are lazy-loaded from System Settings locations when the NAP modal opens, and the Barangay field is shown after Latitude/Longitude. The old free-text Location field is no longer shown in the NAP add/edit modal. Splitter ratio is limited to radio choices `1x8` and `1x16` in the UI and validated server-side as `1:8` or `1:16`. NAP port capacity remains an internal/default backend value and is no longer exposed in the NAP add/edit modal.
- The NAP Boxes page groups records as collapsible OLT rows, then collapsible PON rows, then NAP child rows. It has OLT, PON, status, and search filters, and child NAP rows keep Customer Profiling-style edit/delete actions.
- NAP delete is allowed only when no splitter records are assigned to the NAP.
- Splitter records live under Network Settings -> Insertion Loss -> Splitters in the shared sidebar as manufacturer/model catalog records rather than required NAP assignments. The page uses standard Tabler `nav-tabs` for PLC/LCP/FBT type switching. The splitter modal no longer asks for Splitter Name or Assigned NAP; backend records derive an internal name from manufacturer, model, and type while preserving old hidden NAP links if an existing record already had one. PLC splitters model uniform planar-lightwave circuit splitters and LCP records model Local Convergence Point splitter modules/cabinets where feeder fibers are split into distribution fibers before NAP/drop service. PLC and LCP catalog records support multiple selected ratio profiles on one manufacturer/model record, limited to the operator-approved 1:4, 1:8, and 1:16 ratios; each selected ratio stores its own output-port insertion-loss rows. The PLC add/edit modal starts the manufacturer/company field as a dropdown of saved PLC manufacturers plus `+ Add new manufacturer`; choosing that action switches the field to text entry, and saved manufacturers appear in later dropdowns. Network Topology exposes each selected PLC/LCP ratio as a separate choice under the same manufacturer/model, such as Fourleaf `1x8` and `1x16`. FBT splitters model fused-biconical taper splitters or tap/coupler-style splitters and auto-populate a ratio table with preset ratios `1/99`, `5/95`, `10/90`, `15/85`, `20/80`, `25/75`, `30/70`, `35/65`, `40/60`, and `50/50`; operators can add custom ratio rows. FBT ratio rows capture connector loss, deployment NAP loss, and next NAP loss in one comma- or slash-separated text field per selected 1310, 1490, and/or 1550 nm wavelength set.
- Fiber Optic insertion loss profiles live under Network Settings -> Insertion Loss -> Fiber Optic. Records are manufacturer/company-led catalog entries with optional model, core count, tube/core color groups, and insertion loss per 1000m at 1310, 1490, and 1550 nm. Operators no longer enter a profile name or fiber type; the API derives an internal display label from manufacturer/model/core count. Manufacturer/company and at least one wavelength loss value are required. The Fiber Optic page has separate List and Settings tabs. Settings stores the module-local fiber and tube/group color palettes. Defaults follow the common TIA-598 12-color order: blue, orange, green, brown, slate, white, red, black, yellow, violet, rose, and aqua. Core-count choices are a dropdown with 1, 2, 4, 6, 8, 12, 24, 48, 60, and 72. Profiles with 12 cores or fewer show core colors only with no tube selector; 24 cores and above are grouped into 12-core tube groups.
- The Mapping page is a full-bleed Network Settings page shown above the OLT sidebar group. It displays OLT markers and only NAP markers that have a corresponding `nap:<id>` node in Network Topology, then derives visible NAP links from Network Topology source paths instead of raw PON assignment: PON-sourced NAPs draw from the OLT marker, downstream NAPs draw from their mapped upstream NAP when available, and Junction Box sources resolve to the nearest upstream OLT/NAP because the Mapping page has no junction marker layer yet. It supports search, OLT/type filters, zoom buttons, mouse-wheel zoom, mouse panning, and a Move markers switch. When Move markers is enabled, operators can drag visible OLT or NAP markers; dropping a marker converts the screen point through the current Web Mercator projection into latitude/longitude and saves it back to the OLT or NAP record. Tiles are recalculated from the current pan/zoom so panning reveals surrounding map tiles instead of blank canvas. Marker placement uses latitude/longitude when present and falls back to a stable topology layout so records without coordinates still render. NAP coordinates saved in either decimal or DMS format, such as `17°31'49.77"N`, are parsed for map placement. Custom OLT/NAP marker images are read from System Settings -> Images. NAP marker images render with rounded corners and inherit their parent PON color as the marker stroke.
- The Network Topology page is a separate OLT-tabbed TreeView shown below Mapping in the Network Settings sidebar. Each OLT has its own tab ordered by OLT `displayOrder`; dragging SNMP OLT rows in OLT SNMP is the operator UI for changing that order. The active tab renders fixed-height rows for the OLT root, PON branches, and mapped NAP/Junction rows indented under their saved `sourceKey`. The main topology view no longer uses a movable/zoomable canvas, inline card expansion, or resizable objects, so OLT/PON/NAP/Junction items cannot overlap visually. A bendable SVG connector layer draws parent-child lines without arrowheads from the saved source row to the child row, including direct NAP-to-NAP links. Fiber Link assignment is now PON-owned: only PON rows expose the Fiber Link action, which opens a PON-level canvas showing that PON and its mapped downstream NAP/Junction topology. Only fiber line segments inside that canvas are clickable; selecting a segment opens the Fiber Link modal for fiber profile, fiber core, total length, optical loss values, and line styling, and closing the Fiber Link modal returns to the PON canvas. The PON Fiber Link canvas supports pan/zoom/reset controls on a grid background like the NAP Splitter Layout, renders PON rows with the existing PON icon and NAP rows with the configured NAP marker image, and lets operators click each segment-end connector to cycle Fusion, Mechanical, and SC Connector shapes directly on the canvas. Changing the PON segment-end connector syncs the first splitter input connector for that NAP/Junction, and changing that first input connector in the splitter layout syncs back to the PON segment. Operators can click NAP/Junction nodes inside the PON canvas to open that container's splitter layout as a nested editor; the splitter modal shows the incoming PON fiber context and a feeder line entering the input side so splitter chains can be connected to the upstream segment. Opening the same splitter layout from the Topology row action now also resolves the incoming topology edge so the incoming fiber context appears consistently outside the PON Fiber Link canvas. Saved segment lengths resize the PON canvas links against the longest saved segment in that PON, with default max/min sizes of 500px and 80px managed from Fiber Settings inside the PON modal; visible line labels show the fiber/core and total distance rather than the internal render-size percentage. Fiber link colors are derived from the selected Fiber Optic core color instead of a manual line-color field. PON/NAP/Junction rows expose Tabler-style action badges for adding an assigned NAP, adding a module-local Junction Box, opening the splitter modal, or removing a mapped NAP/Junction branch. NAP boxes added from an existing NAP/Junction store that clicked row as their API-persisted node `sourceKey` so NAP-to-NAP paths connect directly. Removing a mapped NAP/Junction opens a confirmation modal with the selected object information plus downstream object/link/splitter counts, then removes the selected object and downstream Network Topology branch if confirmed. Splitter editing for NAP/Junction containers is handled only in the larger modal layout surface; the main TreeView row stays fixed and only shows a compact splitter-chain summary such as `FBT:5/95-1x8PLC`. The old splitter dropdown and chip tags are hidden for now. Connector plus buttons inside the modal open a compact anchored splitter popup for type, maker/model, and ratio/output selection, and use a wider hover target plus a delayed hide so the pointer can move from connector dot to plus button reliably; input connector ends do not show a plus button. Internal splitter circles can be clicked to select and removed with Delete/Backspace or the hover `-` control. Removing a splitter removes only that splitter; children are detached so connector ends remain available for re-joining. Child splitters spawn from the clicked output connector without moving the parent splitter, with a short branch-growth animation. Curved SVG fiber paths connect splitter input dots, splitter circles, split branches, and output connector dots inside the modal. IN/OUT no longer use fixed left/right target circles; the first splitter in a container shows a delayed-hide hover `Set as IN` action that marks its input connector with an IN badge, while the last splitter in the container shows `Set as OUT` that marks its continuation output connector with an OUT badge. Once set, those actions toggle to `Remove IN` and `Remove OUT`; connector dots cycle labels/shapes between Fusion as an orange oval, Mechanical as a black rectangle, and SC Connector as a blue rectangle. The toolbar has Reset Topology to clear added NAP mapping, Junction Boxes, splitter assignments, saved link settings, and custom positions so only OLT and PON rows remain. Network Topology success messages render as centered TreeView toasts that auto-hide after six seconds. OLT/NAP artwork uses System Settings -> Images marker assets, while PLC 1x8 and 1x16 splitter instances render as high-quality inline SVG equipment artwork so the splitter stays sharp at larger sizes. The compatibility `GET/PATCH /api/network-settings/fiber-mapping` endpoint persists edge settings, PON fiber link scaling settings, legacy `napSplitters`, module-local `junctionBoxes`, generalized `containerSplitters`, per-instance `containerSplitterAssignments` including optional parent-terminal attachment, and connector `connectionPoints` with connection labels, endpoint positions, and optional IN/OUT endpoint roles in module-local JSON. Saved main-node `x/y` and lock values are retained only for backward compatibility.
- Network Topology splitter modal note: NAP/Junction splitter internals use flexible curved SVG paths, click-to-select splitter circles with Delete/Backspace or hover `-` removal, non-cascading splitter deletion, draggable connector/branch endpoints with output-to-input auto-attach, and a larger modal layout canvas opened from the TreeView row action. The large modal canvas supports mouse-wheel zoom, zoom buttons, reset view, and drag-panning on empty canvas space; splitter and connector dragging compensates for modal zoom. The old summary line, splitter dropdown, inline expanded object, and splitter chip tags are intentionally hidden for now; connector plus controls open the compact anchored splitter popup, add splitters to the clicked output terminal, fall back to the other FBT branch when the requested branch is occupied, keep the parent splitter fixed, and animate the new branch/splitter spawn. New splitters start with detached input/output dots for custom line shaping; IN/OUT assignment is handled through delayed-hide splitter hover actions that toggle between Set and Remove states and render the IN/OUT badge directly on the connector endpoint.
- PLC/LCP splitter equipment in the NAP/Junction splitter modal uses a full-length incoming branch matching the output branch length, and connector points render above the equipment SVG so the incoming fiber connector remains visible when a PLC/LCP splitter is connected directly to the feeder.
- LCP output handling in the NAP/Junction splitter modal is port-based: each 1x4, 1x8, or 1x16 output port renders its own separated branch wire and connector terminal (`port1`, `port2`, etc.) so operators can attach downstream splitter objects or mark individual customer house drops. PLC topology rendering stays as one splitter output connector, while its catalog record can still keep per-port insertion-loss values. FBT output handling exposes OUT actions on both Splitter A and Splitter B branches. IN remains single per container, while LCP and FBT can keep multiple valid OUT/customer-drop endpoints.
- Topology, PPPoE provisioning queue, IP/VLAN planning, and network events remain planned future scope.

### MikroTik And PPPoE

- MikroTik router records with identity, management endpoint metadata, role, API readiness, PPPoE server interface, and status.
- `GET /api/network-settings/pppoe-accounts` opens RouterOS API sessions to saved MikroTik API devices, reads `/ppp/secret/print` and `/ppp/active/print`, merges rows by username, and returns read-only live PPPoE account/session rows with router, status, caller ID/MAC, assigned IP, profile, uptime, last caller ID, logout, and disconnect reason.
- `PATCH /api/network-settings/devices/{device_id}/location-bindings` stores the System Settings location ids/snapshots bound to a MikroTik API router. `GET /api/network-settings/router-location-bindings` lists all MikroTik router bindings, and `GET /api/network-settings/routers/by-location` resolves a customer location id/name/barangay/municipality/province to matching routers for future provisioning.
- `PATCH /api/network-settings/devices/{device_id}/olt-location` stores one OLT mapping location for an SNMP OLT device, validates latitude/longitude, and creates or updates the linked OLT inventory row used by the Mapping page.
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

- Frontend import: `features/network-settings/web/NetworkSettingsPage.jsx`.
- Backend import: `features/network-settings/api/network_settings/router.py`.
- API router export: `router`.
- Metrics export: `network_settings_metrics`.
- Configure hook: `configure_network_settings(current_admin, audit_logger)`.
- App-shell parent route: `/network-settings`.
- App-shell subroutes: `/network-settings/map`, `/network-settings/serviceability-check`, `/network-settings/fiber-mapping`, `/network-settings/mikrotik/settings`, `/network-settings/pppoe-accounts`, `/network-settings/olt/settings`, `/network-settings/olts`, `/network-settings/onus`, `/network-settings/nap-boxes`, `/network-settings/insertion-loss/splitters`, and `/network-settings/insertion-loss/fiber-optic`.
- Shared sidebar grouping: Mapping appears first under Network Settings, followed by Serviceability Check and Topology; MikroTik API and PPPoE Accounts live under a MikroTik subgroup; OLT SNMP, OLT & PON, ONUs, and NAP Boxes live under OLT; Splitters and Fiber Optic live under Insertion Loss. The legacy `/network-settings/fbts` path still opens Splitters for bookmark compatibility.
- The frontend renders these as separate route pages, not as an internal tabbed workspace. The parent `/network-settings` route remains the overview.
- There is no standalone Devices route in the current sidebar. The legacy `/network-settings/devices` path loads MikroTik API for bookmark compatibility.
- CRUD tables and create/edit modals use the same general UI pattern as Customer Profiling: card table headers, compact search input, icon-only create/refresh buttons, table row action buttons, and modal forms.
- The OLT & PON page combines OLT and PON management in one table: OLT rows expand to show their PON CRUD table, manually entered PON power module brand and dBm details, a per-PON Power action, an OLT-row Power action that applies the same brand/dBm reading to all PONs under that OLT, and a per-OLT PON add action. The top-level Add OLT action is hidden because OLT inventory is now expected to come from OLT SNMP capture.
- The ONUs page is a separate captured-inventory table and auto-refreshes while open so operators do not need to manually reload after a capture. It includes KPI cards, ONUs-per-PON summary buttons, status/OLT/PON filters, and no poll column.
- The PPPoE Accounts page is a separate read-only RouterOS API discovery page for saved MikroTik devices. It does not create, edit, or delete PPP secrets yet.
- The Mapping page reads shared map tile providers from System Settings -> Maps (`/api/system-settings/map-providers`) through `features/system-settings/web/mapProviders.js`. Built-in defaults preserve Esri Street, Esri Satellite, and OpenStreetMap, and operators can enable deeper providers such as Google Roadmap/Satellite, TomTom, MapTiler, and Mapbox after adding public API keys. Google providers create the required Google Map Tiles API session token before building tile URLs. Mapping exposes an enabled-provider selector, honors the selected provider's max zoom, keeps HD mode, and stores provider id, HD mode, and layer visibility in browser localStorage so preferences survive page refreshes and shared server restarts for the same browser. Wheel zoom anchors to the cursor; if the selected provider's native max zoom is reached, additional view zoom still uses digital scaling. The Mapping legend is positioned in the upper-left of the map and is interactive: operators can show/hide OLT markers, Network Topology-backed NAP markers, Network Topology links, and marker name labels. By default, the page shows OLT/NAP marker images with neutral text names only; NAP marker artwork has rounded corners and a stroke inherited from the assigned PON color, and OLT marker artwork has its own rounded indigo stroke. Move markers mode persists dragged OLT/NAP marker coordinates through the existing OLT and NAP PATCH APIs. Clicking an OLT/NAP marker focuses that object, enables Mapping links, shows only links directly connected to the focused object, and marks the object with a blue ring; clicking empty map space clears focus and restores all visible links. Mapping topology links can be selected to open a compact draggable line menu labeled with OLT/NAP names; line clicks are view-first, and operators must enable the Tabler-style rectangular Edit Line switch before left-clicking a link to insert draggable bend handles. While Edit Line is enabled, the selected line renders last in the SVG layer, turns blue, and stays clickable even when links overlap; other Mapping links are pointer-disabled and muted so they cannot steal clicks or open another line menu. The line menu includes a Hide Other Lines switch that makes non-selected links nearly transparent by opacity. Operators must disable Edit Line on the current menu before selecting another link. The draggable line menu keeps its current position while adding bend handles on the selected line, including after the operator manually moves the menu. Hovering a bend handle shows its remove button, and bends persist as `mapBendPoints` on the existing fiber mapping edge config.
- The Serviceability Check page is a customer-first Network Settings page at `/network-settings/serviceability-check`. The default view is a Customer Profiling table with search, status filter, computed serviceability status, recommended NAP, distance, remaining ports, and customer address. Selecting a customer opens a split customer/map view: the left panel shows customer identity plus a Transfer / choose NAP selector, while the right panel shows only that customer's house marker plus GPS-ready NAP boxes whose saved location fields match the customer's service location. The page can be opened from Customer Profiling with `/network-settings/serviceability-check?customerId=<customer id>`, which selects the customer automatically. It uses the same shared System Settings map providers as Mapping and exposes the active map provider as a compact toolbar button beside HD; clicking it opens a mini provider menu. NAP detail cards appear only after an operator clicks a NAP marker. Serviceability now reads Network Topology splitter assignments for each NAP through the same normalized assignment source as Topology (`containerSplitterAssignments`, `containerSplitters`, and legacy `napSplitters` fallback): assigned PLC splitters override NAP default capacity for availability, and the clicked NAP detail shows only PLC splitter equipment using the same inline SVG rectangle/port artwork as Network Topology. Future technician mapping fields on customer records such as `mappedNapId`/`napBoxId` plus mapped splitter/port fields are detected defensively; when present, the customer row shows a `Mapped` status, the mapped NAP marker is labeled mapped, assigned PLC ports are colored green, and the selected mapped port is highlighted in blue. The actual technician workflow to persist customer-to-NAP-port mapping is still future work, so Serviceability treats these fields as a placeholder source until the technician portal owns assignments. It clears its ready-tile cache when the provider or provider session changes and keeps the last fully loaded tile layer visible while the next pan/zoom tile set loads. The page auto-selects the nearest NAP with remaining capacity unless an operator chooses a specific NAP, calculates remaining ports from topology PLC output ports or NAP `portCapacity`/splitter ratio and known usage fields such as `fbtCount`, and draws the customer drop path. Serviceable or mapped paths render as a solid green NAP-to-house line with a moving green light; unavailable paths render as a red cut line with a no-service icon at the break. The old click-to-place customer map workflow and Mouse Zoom Tracker debugging overlay were removed.
- The OLT SNMP location binding modal's Capture picker uses the shared map provider selector and provider max zoom when filling OLT latitude/longitude.
- Network Settings success messages render through a fixed upper-right toaster with a close button and auto-hide after six seconds.
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
- `PATCH /api/network-settings/devices/order`
- `PATCH /api/network-settings/devices/{device_id}/location-bindings`
- `PATCH /api/network-settings/devices/{device_id}/olt-location`
- `GET /api/network-settings/router-location-bindings`
- `GET /api/network-settings/routers/by-location`
- `GET /api/network-settings/devices/{device_id}/captures`
- `POST /api/network-settings/devices/{device_id}/capture`
- `GET /api/network-settings/pppoe-accounts`
- `GET/POST/PATCH/DELETE /api/network-settings/olts`
- `GET/POST /api/network-settings/olts/{olt_id}/pons`
- `PATCH /api/network-settings/olts/{olt_id}/pons/power`
- `GET /api/network-settings/pons`
- `PATCH/DELETE /api/network-settings/pons/{pon_id}`
- `PATCH /api/network-settings/pons/{pon_id}/power`
- `GET /api/network-settings/onus`
- `GET/POST/PATCH/DELETE /api/network-settings/nap-boxes`
- `GET/POST/PATCH/DELETE /api/network-settings/fbts` (Splitters compatibility endpoint)
- `GET/PATCH /api/network-settings/fiber-optic-settings`
- `GET/POST/PATCH/DELETE /api/network-settings/fiber-optic-losses`
- `GET/PATCH /api/network-settings/fiber-mapping`

## Known Risks And Boundaries

- On 2026-05-25 during a shared runtime rebuild, `/app/data/network_settings.json` was found truncated before device records. A corrupt backup was preserved in the API container data volume as `network_settings.corrupt-20260525T171553Z.json`, and a syntactically valid recovered JSON was written, but Network Settings currently loads zero saved devices from that runtime file. MikroTik/OLT device records need restoration from an external backup or re-entry in the UI.
- MikroTik API device passwords are intentionally returned in regular MikroTik API device responses for operator visibility. SNMP credentials and PPPoE passwords should still not be returned in regular API responses.
- Current device credential fields are stored in module-local server data when available and still must move to System Settings or another secure credential store with encryption before production.
- Live MikroTik or OLT changes require explicit adapter design, credential storage, retry/rollback behavior, and audit logging.
- The JSON persistence bridge is for staging continuity only; production needs shared PostgreSQL persistence and encrypted secret handling.
- Device discovery should not silently overwrite source-of-truth data. Reconciliation should show differences for operator review.
- The module no longer seeds sample OLT/PON/NAP/splitter/device records on API startup; first SNMP testing should begin by adding an OLT device in the SNMP tab.
- Network Settings should not own customer identity, service catalog, billing subscription, or ticket lifecycle; it should reference those records.
- Ticketing creates the work context; Network Settings executes or records network provisioning state.

## Next Recommended Work

1. Add PPPoE-to-ONU/customer mapping using MikroTik caller IDs, OLT ONU MAC/serial, and service/customer records.
2. Add PPP profile and PPPoE desired-state CRUD/provisioning actions after mapping is stable.
3. Add Ticketing-to-Network provisioning request contract after Ticketing installation fields are finalized.
4. Add Service Account network attachment fields.
5. Replace module-local JSON persistence with shared PostgreSQL persistence and encrypted device secrets.
