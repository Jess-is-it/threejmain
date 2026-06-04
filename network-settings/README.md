# Network Settings

Network Settings is the ISP network source-of-truth module for access network assets, starting with device records, SNMP capture runs, MikroTik PPPoE account discovery, OLTs, generated PON ports, captured ONU inventory, NAP boxes, PLC/LCP/FBT splitter catalog records, and fiber mapping.

This module is now wired into `app-shell/` with module-local JSON persistence when `/app/data` is available. The JSON store is written atomically through a temp file plus replace operation to avoid truncated data files during shared server restarts. Live device provisioning, PPPoE-to-ONU mapping, advanced topology automation, and durable PostgreSQL persistence remain future work.

## Research Baseline

Enterprise ISP OSS/BSS systems treat network settings as more than static configuration. The feature should combine resource inventory, network topology, service activation, operational assurance, and change/audit history.

Research references used for this plan:

- [TM Forum Resource Inventory Management API](https://www.tmforum.org/open-digital-architecture/open-apis/resource-inventory-management-api-TMF639/v4.0): standardized resource inventory for querying and manipulating telecom resource inventory.
- [TM Forum Resource Activation Management API](https://www.tmforum.org/open-digital-architecture/open-apis/resource-activation-management-api-TMF702/v4.0): activation/configuration API for querying activation state and creating, updating, configuring, or activating resource instances.
- [TM Forum Service Ordering Management API](https://www.tmforum.org/open-digital-architecture/open-apis/service-ordering-management-api-TMF641/v4.1): standardized service order model for placing, updating, retrieving, filtering, and notifying service orders.
- [TM Forum Trouble Ticket Management API](https://www.tmforum.org/resources/specifications/tmf621-trouble-ticket-management-api-rest-specification-r19-0-0/): trouble ticket model for issues created by customers or other systems, including severity, priority, related entities, notes, and notifications.
- [Broadband Forum TR-385 xPON YANG modules](https://wiki.broadband-forum.org/display/BBF/TR-385%3A%2BITU-T%2BPON%2BYANG%2BModules): PON management data models for OLT/ONU configuration, fault management, performance management, PON link resources, ONU activation, and authentication.
- [MikroTik RouterOS PPPoE docs](https://help.mikrotik.com/docs/spaces/ROS/pages/2031625/PPPoE) and [PPP AAA docs](https://help.mikrotik.com/docs/spaces/ROS/pages/132350049/PPP%2BAAA): PPPoE access concentrator behavior, static/dynamic user interfaces, PPP profiles, local users, and RADIUS-backed authentication/accounting.
- [NetBox documentation](https://netbox.readthedocs.io/en/feature/introduction/): mature network source-of-truth models for devices, IPAM, circuits, cabling, topology, desired state, permissions, and change logging.
- [LibreNMS Adding a Device](https://docs.librenms.org/Support/Adding-a-Device/) and [LibreNMS Auto-Discovery Setup](https://docs.librenms.org/Extensions/Auto-Discovery/): device onboarding fields, default SNMP communities, and discovery behavior.
- [LibreNMS Fetching SNMP Data](https://docs.librenms.org/Developing/Using-SnmpQuery/) and [Discovery Support](https://docs.librenms.org/Support/Discovery%20Support/): discovery runs query devices through SNMP get/walk operations, then process returned data into inventory.
- [RFC 3418 SNMPv2-MIB](https://www.rfc-editor.org/rfc/rfc3418.html): standard system objects such as `sysDescr`, `sysObjectID`, `sysUpTime`, `sysContact`, `sysName`, and `sysLocation`.
- [RFC 2863 IF-MIB](https://datatracker.ietf.org/doc/html/rfc2863): standard interface inventory/status objects including `ifDescr`, `ifAdminStatus`, `ifOperStatus`, `ifName`, and `ifAlias`.
- [Corning FTTH 101 tutorial](https://www.corning.com/media/worldwide/coc/documents/Fiber/IEC_FTTH_101_Tutorialv2.pdf): FTTH topology uses splitter/local convergence points between feeder and distribution network segments.
- [FIBERVISION PLC vs FBT overview](https://www.fibervision.com.cn/support/2026-Blogs/Understanding-Fiber-Optic-Splitters%2C-PLC-vs-FBT.html): PLC splitters provide uniform multi-output splitting across common FTTH ratios, while FBT splitters use fused/tapered fiber coupling.
- [ISE Magazine optical splitter troubleshooting](https://www.isemag.com/fttx-optical-networks/article/14267547/troubleshooting-optical-splitters): FTTX splitter work should track passive component type, ratio, insertion loss, and field troubleshooting context.
- [Prysmian fiber optic color code guide](https://na.prysmian.com/sites/na.prysmian.com/files/media/documents/TLS-0007-0121_Color%20Code%20Guide%20For%20Fiber%20Optic%20Specifications_LR_0.pdf) and [FOA fiber optic color codes card](https://foa.org/tech/coloc_codes/Color_Codes_Card_Fiber_Device.pdf): common TIA-598-based fiber/tube order uses 12 colors: blue, orange, green, brown, slate, white, red, black, yellow, violet, rose, and aqua. Larger cables repeat the sequence by tube/group, stripe, dash, or binder convention depending on cable construction and manufacturer.

## Routes

Planned app-shell route:

```text
/network-settings
```

Planned sub-navigation:

| Sub-nav | Purpose |
| --- | --- |
| Overview | Network KPIs and recent OLT/NAP/splitter records. |
| Map | Network map shown first in the shared sidebar, above MikroTik. |
| Fiber Mapping | Open canvas for building OLT-to-PON-to-NAP fiber paths, placing lockable objects, assigning splitters/fiber profiles to links, and computing first-pass optical power. |
| MikroTik / Settings | MikroTik API device records used for PPPoE discovery and future provisioning. |
| PPPoE Accounts | Live MikroTik RouterOS API view of PPP secrets and active sessions. |
| OLT / Settings | OLT SNMP device records used for capture, polling, and discovery. |
| OLT & PON | OLT CRUD plus generated and manually editable PON records under each OLT. |
| ONUs | Captured ONU/ONT inventory grouped by OLT and PON, refreshed automatically in the UI. |
| NAP Boxes | NAP CRUD assigned to a PON port. |
| Insertion Loss / Splitters | PLC, LCP, and FBT splitter CRUD by manufacturer/model. PLC and LCP are limited to 1:4, 1:8, and 1:16 ratios with insertion loss tracked per output port. FBT records auto-populate preset ratio rows and let operators add custom ratios with connector/deployment NAP/next NAP loss entered as comma- or slash-separated values for selected 1310, 1490, and/or 1550 nm wavelengths. Compatibility route remains `/network-settings/fbts`. |
| Insertion Loss / Fiber Optic | Fiber optic manufacturer/company catalog entries with optional model and insertion loss per 1000m at 1310, 1490, and 1550 nm. Manufacturer/company and at least one wavelength loss value are required; operators no longer enter a separate profile name or fiber type. The page has List and Settings tabs, a core-count dropdown for 1, 2, 4, 6, 8, 12, 24, 48, 60, and 72 cores, generated/editable tube/core color groups for 24+ cores, and Fiber Optic settings for the fiber/tube color palette. |

API prefix:

```text
/api/network-settings
```

Implemented endpoints:

- `GET /api/network-settings/meta`
- `GET /api/network-settings/overview`
- `GET/POST/PATCH/DELETE /api/network-settings/devices`
- `PATCH /api/network-settings/devices/{device_id}/location-bindings`
- `GET /api/network-settings/router-location-bindings`
- `GET /api/network-settings/routers/by-location`
- `GET /api/network-settings/devices/{device_id}/captures`
- `POST /api/network-settings/devices/{device_id}/capture`
- `GET /api/network-settings/pppoe-accounts`
- `GET/POST/PATCH/DELETE /api/network-settings/olts`
- `GET/POST /api/network-settings/olts/{olt_id}/pons`
- `GET /api/network-settings/pons`
- `PATCH/DELETE /api/network-settings/pons/{pon_id}`
- `GET /api/network-settings/onus`
- `GET/POST/PATCH/DELETE /api/network-settings/nap-boxes`
- `GET/POST/PATCH/DELETE /api/network-settings/fbts` (Splitters compatibility endpoint)
- `GET/PATCH /api/network-settings/fiber-optic-settings`
- `GET/POST/PATCH/DELETE /api/network-settings/fiber-optic-losses`
- `GET/PATCH /api/network-settings/fiber-mapping`

OLT creation generates four default PON records unless the operator sets another `defaultPonCount`. Increasing an OLT's default PON count adds missing PON records. Decreasing the target count does not silently delete PONs; operators can delete unneeded PON rows manually, and the API blocks deleting PONs that still have assigned NAP boxes.

The old combined Devices page has been removed from navigation. The API device list now lives under MikroTik -> Settings and is scoped to MikroTik API devices. The SNMP device list now lives under OLT -> Settings and is scoped to OLT SNMP devices. The device modal still starts with access-method button choices and radio-style device type selection before showing connection fields, but each Settings page preselects and limits the relevant access/type. The form no longer asks operators for status, vendor, model, API profile, or notes. API MikroTik records require RouterOS API username and password, and saves run an authenticated RouterOS API login test against the configured host/port before accepting the record. The login test tries the current RouterOS name/password API login first and falls back to legacy challenge-response login for older RouterOS releases. Saved API passwords are persisted server-side for staging continuity, but are not returned in normal API responses; edit mode leaves the password blank unless the operator wants to replace it. MikroTik rows include a location-binding action that lets operators bind multiple System Settings Location Management records to the router; Customer Network will use that binding to select the PPPoE provisioning router from a customer's location during installation. The SNMP add flow follows the LibreNMS add-device shape for the first OLT test: hostname/IP is required, display name defaults to hostname/IP, SNMP v1/v2c accepts a community but also allows blank so future polling can try all configured `snmp.community` communities, SNMPv3 uses auth level/user/password/algorithm and crypto password/algorithm, and every SNMP record stores port, transport, port association mode, poller group, and force-add metadata. Secret fields are persisted server-side in module data when available, but are not returned in normal API responses.

The OLT Settings table includes a Capture action for SNMP records. Capture currently supports SNMP v1/v2c over UDP/UDP6 without adding external Python dependencies. A run fetches SNMPv2-MIB system identity and IF-MIB interface columns, stores the capture result, displays captured system/interface/PON/ONU candidate information, and reconciles OLT devices into the OLT & PON and ONUs inventory. Generic PON detection is based on PON-like interface names/descriptions (`GPON`, `EPON`, `XGSPON`, `XPON`, `PON`) while ONU detection uses subscriber-side ONU/ONT/GEM/TCONT-style interface rows when the OLT exposes them through IF-MIB. VSOL-style child interfaces such as `EPON0/1:1` are treated as ONU rows under physical PON `EPON0/1`, not as separate PON ports, and the VSOL interface-to-MAC table is used as mapping evidence when available. Vendor and model are inferred from `sysDescr` and common enterprise OID prefixes and shown in the OLT Settings table after capture. ONU capture records standard identity/status fields and parses serial number, MAC address, Rx/Tx optical power, distance, temperature, voltage, bias current, VLAN, service port, profile, and last-down reason when the OLT exposes those values in generic SNMP interface text. For HS Fiber/HSGQ enterprise OID `1.3.6.1.4.1.50224`, capture also walks the EPON ONU info and ONU optical tables to fill ONU MAC address, receive power, transmit power, distance, temperature, voltage, and bias current. The API now starts a background Network Settings poller on shared app startup; it checks for due SNMP devices every `NETWORK_SETTINGS_POLL_LOOP_SECONDS` seconds, then runs the same capture/reconciliation path when `lastCapturedAt` reaches the device `pollIntervalSeconds` value. The default device poll interval is 300 seconds. The ONUs page auto-refreshes every 15 seconds while open. Additional vendor-specific ONU optical OIDs remain future work.

The PPPoE Accounts page lives under the MikroTik navigation group. It reads configured PPP secrets and active PPP sessions from each saved MikroTik API device through RouterOS API, merges them by username, and displays account status, router, caller ID/MAC, assigned IP, profile, uptime, last caller ID, last logout, and disconnect reason. The UI includes KPI cards, router/status/profile filters, search, show-entries control, sortable columns, pagination, manual refresh, and a 30-second auto-refresh while the page is open. This is read-only discovery for now; provisioning and PPPoE-to-ONU/customer mapping are the next layer.

The Fiber Mapping page lives directly under Network Settings, below Map and above the MikroTik group. It renders an open scrollable canvas where every OLT is shown with its PON ports automatically placed to the right and connected by editable lines. OLT, PON, and NAP objects can be dragged and locked. Hovering a PON shows an add button that lists NAP boxes assigned to that PON; selecting a NAP places it on the canvas and connects it to the PON. OLT/NAP artwork uses the marker images configured in System Settings -> Images, while PON and splitter placeholders use icons. NAP boxes can carry PLC/LCP/FBT splitter assignments, and selected fiber links can store fiber optic profile, wavelength, length, source power, connector loss, splice loss, line color/style, notes, and a computed first-pass loss/estimated receive-power summary. The first implementation persists canvas node positions, lock states, edge settings, and NAP splitter assignments in Network Settings JSON data through `GET/PATCH /api/network-settings/fiber-mapping`.

## Planned CRUD Scope

First functional implementation should prioritize records and workflows that support installation and PPPoE provisioning:

- OLT records: create, update, list, archive, tag by site/location, and monitor administrative status.
- Device records: create, update, list, archive, split by API or SNMP access, and support MikroTik and OLT endpoints without linking them to OLT inventory records during the first SNMP test phase.
- PON port records: create, update, list, archive, link to OLT, track capacity, split ratio, service VLANs, optical thresholds, and operational status.
- NAP box records: create, update, list, archive, link to PON port and System Settings location, track splitter layout, available/used ports, and field notes.
- MikroTik router records: create, update, list, archive, store non-secret connection metadata, track API readiness, router role, and PPPoE server interface.
- PPPoE profile records: map Service Catalog plans to router profiles, rate limits, address pools, DNS policy, VLAN/service tags, and accounting behavior.
- PPPoE account records: create/update/disable account state linked to Customer Profiling, Service Account, Service Order, Ticketing ticket, MikroTik router, and PPP profile.
- Provisioning jobs: track requested action, source ticket/order, target device, desired state, job state, validation errors, retry count, and rollback notes.
- Topology nodes and edges: model device, port, circuit, splitter, NAP, drop, ONU/CPE, router, and customer service attachment.
- Event/audit records: capture changes, provisioning actions, status transitions, and failed network operations.

## Enterprise/ISP Workflow Plan

### 1. Installation To PPPoE Provisioning

1. Customer Profiling owns the customer identity and service address.
2. Service owns the Service Account and Service Order.
3. Service creates a Ticketing ticket for installation or service work.
4. Ticketing installation workflow collects field completion data: installed ONU/CPE, NAP box, port, drop cable, assigned OLT/PON, and target MikroTik router/profile.
5. Network Settings creates a provisioning job linked to the ticket, customer, Service Account, Service Order, and selected network resources.
6. The job plans PPPoE username, password policy, router/profile/IP pool, service VLAN, and account status.
7. A future device adapter creates or updates the PPPoE account on MikroTik or RADIUS and records the activation result.
8. Network Settings writes the final network attachment back to the Service Account context and appends Ticketing notes.
9. Ticketing closes installation only after required network provisioning and verification steps pass.

### 2. Trouble Ticket Support

Network-linked tickets should show:

- Customer and Service Account.
- PPPoE account status and last known session state.
- Router, OLT, PON, NAP, and topology path.
- Recent provisioning/audit events.
- Related alarms or capacity warnings.

Ticketing should be able to open Network Settings in context for the affected service path. Network Settings should be able to create or suggest tickets when alarms, failed provisioning, or topology impacts are detected.

### 3. Plan Change, Suspension, Reconnection

Service Order types should drive network changes:

- Plan Upgrade/Downgrade: update PPP profile or RADIUS rate policy, then notify Billing and Ticketing.
- Temporary Suspension: disable PPPoE access or move to suspended profile.
- Reconnection: restore the active PPP profile and validate authentication.
- Relocation: move topology/NAP attachment and re-provision if the router/PON path changes.
- Equipment Replacement: update ONU/CPE/NAP port attachment and preserve Service Account continuity.

### 4. Capacity And Planning

Network Settings should support operational planning:

- OLT and PON utilization.
- NAP box port utilization.
- IP pool exhaustion.
- VLAN/service-tag assignment.
- Oversubscription warnings.
- Router PPPoE active-session capacity.
- Installation readiness by barangay/site.

## Data Model Draft

Key first-pass records:

- `NetworkSite`: site or service-area grouping, linked to System Settings locations.
- `Olt`: OLT identity, vendor/model, management endpoint, site, status, firmware, and notes.
- `PonPort`: OLT slot/port identity, PON technology, split ratio, service VLAN, capacity, and optical thresholds.
- `NapBox`: field cabinet/box identity, location, linked PON port, splitter layout, port capacity, available ports, and field notes.
- `TopologyNode`: normalized topology item for OLT, port, splitter, NAP, router, ONU/CPE, customer drop, or provider circuit.
- `TopologyEdge`: physical/logical connection between nodes with cable/circuit metadata.
- `MikroTikRouter`: router identity, management endpoint metadata, role, API readiness, PPPoE server interface, and status.
- `NetworkDevice`: MikroTik or OLT endpoint, access method (`API` or `SNMP`), management host, API username, hidden API password flag, non-secret profile names, status, and optional linked OLT inventory record. Site / Location is not currently operator-entered in the device form.
- `DeviceCapture`: manual SNMP capture result with system identity, IF-MIB interface rows, inferred PON candidates, capture status/message, and OLT/PON reconciliation summary.
- `Onu`: captured ONU/ONT inventory row linked to OLT and PON, with ONU id, serial, MAC, status, admin/oper status, Rx/Tx power, distance, temperature, voltage, bias current, VLAN, service port, profile, last-down reason, source interface metadata, and last capture timestamp where those values are available.
- `IpPool`: pool name, CIDR/range, router, use case, utilization, and status.
- `VlanProfile`: service VLAN/tag policy, router/OLT applicability, and use case.
- `PppoeProfile`: profile name, plan mapping, rate limit, local/remote address policy, DNS, and accounting mode.
- `PppoeAccount`: customer/service-linked account, username, credential policy, router, profile, status, source ticket, and last provision result.
- `ProvisioningJob`: action request, source module, source record, target resource, desired state, job status, attempts, validation errors, and audit metadata.

## Cross-Module Connections

| Module | Connection |
| --- | --- |
| Customer Profiling | Source of customer identity, contact, service address, gender/avatar metadata, and saved location context. |
| Service | Source of Service Account, Service Order, service reference, catalog plan, and lifecycle state. Network Settings should attach network resources to Service Accounts, not directly to Customer Profiling alone. |
| Ticketing | Installation, activation, repair, relocation, equipment replacement, and provisioning tickets should link to PPPoE accounts and topology path. Ticketing should trigger provisioning jobs after installation details are complete. |
| Billing | Billing should depend on Service Account activation; future suspension/reconnection can request PPPoE disable/enable when billing status requires it. |
| Inventory | ONU/CPE, routers, cables, splitters, and materials should be assigned to tickets/service accounts and reflected in network topology. |
| System Settings | Provides reusable service locations, geocoder settings, system-level integration configuration, and future credential profiles. |
| Logs | Receives audit events for network resource edits, provisioning actions, and failed device operations. |
| Account Admin | Owns future permissions for network engineer, NOC operator, installer, admin, and read-only roles. |
| Customer Service Management | Can view service-path context and create follow-up interactions when network issues affect customers. |
| Point of Sale | May sell routers/CPE/accessories that become Inventory assets before installation assignment. |

## Security And Operations Boundaries

- Do not store plaintext router passwords or PPPoE passwords in normal API responses.
- Use System Settings or a future secure credential store for device/API secrets.
- All provisioning actions should be auditable, actor-linked, and reversible where possible.
- First implementation can keep in-memory state; production must use shared PostgreSQL persistence and encrypted secrets handling.
- Device adapters should be isolated from CRUD state so UI planning can work even while live router/OLT integration is disabled.
- Network Settings should model desired state first; live discovery/reconciliation should be explicit and reviewed, not silently accepted as truth.

## First Implementation Milestones

1. Create static module shell and app-shell integration.
2. Add in-memory CRUD for PPP profiles, PPPoE desired-state accounts, PPPoE-to-ONU/customer mapping, and provisioning jobs.
3. Add topology model and simple visual topology page.
4. Add Ticketing integration contract for installation ticket completion to request PPPoE provisioning.
5. Add Service Account network attachment fields and read-only cross-links.
6. Add Inventory equipment assignment links for ONU/CPE/router/material references.
7. Add audit logging through Logs and permissions through Account Admin.
8. Replace in-memory state with shared PostgreSQL tables and migrations.
9. Add MikroTik adapter behind a feature flag or credential profile.
10. Add OLT/ONU integration adapters after vendor protocol and credential decisions are approved.

## Current Status

- Folder created: `network-settings/`
- Status: `functional-shell`
- App-shell navigation, route, API router, Docker copy paths, Vite allowlist, and dashboard metrics are wired.
- CRUD exists for OLTs, PON ports, NAP boxes, PLC/LCP/FBT splitter catalog records, and network device records, with module-local JSON persistence on the shared API data volume when available.
- The PPPoE Accounts page discovers live PPPoE accounts from saved MikroTik API devices by reading RouterOS PPP secrets and active sessions. It is read-only until provisioning and mapping are added.
- OLT Settings includes manual and scheduled SNMP capture for v1/v2c OLT devices. Successful captures save SNMP system info, interface rows, inferred PON and ONU candidates, update device vendor/model, and auto-create/update OLT, PON, and captured ONU inventory records.
- The ONUs page displays KPI cards for total ONUs, online ONUs, offline/problem ONUs, and PONs with captured ONUs. It also shows a per-PON ONU count selector, table filters, and captured ONU details without a poll column.
- OLT creation still creates default PON ports, but the API no longer seeds sample OLT/PON/NAP/splitter records on startup.
- SNMPv3 capture, additional vendor-specific OLT/ONU MIB OID mapping, guaranteed optical metrics across every vendor, and full topology reconciliation remain future work.
- Module-local JSON persistence is a staging bridge; shared PostgreSQL persistence and encrypted secrets handling are still required before production use.
