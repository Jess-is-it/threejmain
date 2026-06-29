# Account Access Management

Account Access Management owns customer-level service-access administration after a Customer Profile exists. Its primary route is `/account-access-management` and its API prefix is `/api/account-access-management`.

## Purpose

Account Access Management connects a customer profile to the customer's subscribed service account:

```text
Customer Profile -> Service Order -> Service Account -> Customer Account
```

The module is not for system-login users, roles, or permissions. System-login access controls live in System Settings -> Access.

## Current Phase 1 Scope

- Show a Customer Accounts table with one row for every visible Customer Profile.
- Treat Customer Accounts as the master access summary after a Customer Profile exists: Internet/PPPoE, Hotspot Access, future IPTV Access, and ticket counts.
- Use Customer Profiling-style search, collapsible filters, and Active/Inactive table tabs with badge counts.
- Keep Customer Accounts tabs limited to `Active` and `Inactive`.
- Move account groupings such as `Needs Action`, `With Internet`, `With Hotspot`, `With IPTV`, and `No Access` into the Access filter.
- Customer Accounts filters include Access, Customer Status, Internet Access, Hotspot Access, IPTV Access, and PPPoE Status.
- Customer Accounts keeps existing rows visible during background refreshes, ignores stale overlapping responses, and skips hidden PPPoE/ONU mapping metrics for faster table loads.
- The Customer Accounts table shows Customer, Internet Access, Hotspot Access, IPTV Access, Tickets, and Action columns.
- The Action column uses Customer Profiling-style icon buttons only. Clicking the row or the View icon opens a 50/50 inline detail panel with customer details and Internet Access, Hotspot, and IPTV tabs.
- The PPPoE & ONUs side-nav item exposes the temporary PPPoE-to-ONU mapping review table as a separate view, outside Customer Accounts and outside the Customer Accounts in-page tabs.
- Show ticket count plus latest assigned ticket Category, Status, Priority, and action hints when a customer has Ticketing records. `INSTALLATION` currently exposes the intended `Create PPPoE Account` action gate.
- Show Internet Access summary with PPPoE account/status, router name, assigned IP, and Service Account plan when available.
- Show Hotspot Access summary from active service-account eligibility, enabled mobile contacts, and Pisowifi sync settings.
- Show IPTV Access as a future-ready summary status when IPTV-like Service Account/Order data exists; no live IPTV provisioning is implemented yet.
- Expose a temporary PPPoE-to-ONU mapping snapshot with one sample dummy customer profile attached to a matched PPPoE/ONU pair for review.
- Keep `Hotspot Access` as a separate operations view for Pisowifi API settings, contact overrides, Full/Partial sync, and sync logs.
- Account Access Management side-nav views are limited to `Customer Accounts` and `PPPoE & ONUs`. Inside Customer Accounts, the in-page view switch includes `Customer Accounts`, `Internet Access`, `Hotspot Access`, and `IPTV Access`; PPPoE & ONUs is not shown there because it is a separate reconciliation view.

Network configuration forms, save actions, MikroTik refresh actions, PPPoE binding, WiFi/CPE editing, and provisioning requests are intentionally hidden from the page for this step.
Service Account and Installation Order columns are intentionally hidden from the Customer Accounts table for this step.

## API

API prefix:

```text
/api/account-access-management
```

Routes:

- `GET /api/account-access-management/meta`
- `GET /api/account-access-management/overview`
- `GET /api/account-access-management/customer-accounts`
- `GET /api/account-access-management/customer-accounts/{customer_id}`
- `GET /api/account-access-management/pppoe-onu-mapping`
- `GET /api/account-access-management/hotspot-access`
- `PATCH /api/account-access-management/hotspot-access/settings`
- `POST /api/account-access-management/hotspot-access/test`
- `PATCH /api/account-access-management/hotspot-access/subscribers/{customer_id}/contacts`
- `POST /api/account-access-management/hotspot-access/sync`
- `POST /api/account-access-management/hotspot-access/subscribers/{customer_id}/sync`

Legacy `/api/account-access-management/accounts` system-login routes return `410 Gone` and direct users to System Settings -> Access.

## Dependencies

- Customer Profiling: source of customer identity and lifecycle.
- Service: source of Service Accounts and installation Service Orders.
- Ticketing: source of customer ticket assignment summaries.
- Network Settings: source of MikroTik PPPoE discovery and captured OLT ONU inventory.
- 3JCentralPisowifi: target system for signed monthly subscriber Hotspot Access syncs.
- Future Network Settings provisioning endpoints: live PPPoE, WiFi/CPE, and other network configuration writes.
- Future IPTV source/provisioning contract: needed before IPTV account/device controls can move beyond summary status.

## Risks And Follow-Up

- Account records are derived from in-memory module sources and reset on API restart.
- Service does not yet expose a dedicated Activation Service Order type/status, so Phase 1 derives activation readiness from completed installation/service-account state.
- PPPoE-to-ONU matching deduplicates captured ONU rows by physical OLT/PON/ONU identity, then uses exact PPPoE caller ID/MAC to captured ONU MAC evidence first. It also treats same-OUI low-byte proximity as a high-confidence match when the tail delta is 8 or less and the PPPoE/ONU pair is the best mutual one-to-one candidate. A conservative metadata fallback remains for ONU identifiers in PPPoE comments/usernames. Rows without a match remain visible and are marked as unmatched.
- The sample customer profile is temporary module-local response data; it does not create a durable Customer Profiling record.
- Live MikroTik provisioning, PPPoE binding, WiFi/CPE writes, audit-grade sync history, and PostgreSQL persistence remain future phases. PPPoE creation should come next and must be gated by an eligible `INSTALLATION` ticket plus a Network Settings router-location binding match.
- Hotspot Access settings/contact overrides persist to `ACCOUNT_ACCESS_MANAGEMENT_HOTSPOT_STATE_PATH` for now. The old `ACCOUNT_ADMIN_HOTSPOT_STATE_PATH` is still accepted as a fallback for existing deployments.
- IPTV Access is currently summary-only and should not create IPTV accounts until a real IPTV service/module contract exists.
