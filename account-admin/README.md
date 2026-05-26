# Customer Network

Customer Network owns customer-level network service administration. The module still lives in the existing `account-admin/` folder and keeps the `/api/account-admin` prefix for app-shell compatibility, but the operator-facing scope is now Customer Network.

## Purpose

Customer Network connects a customer profile to the customer's subscribed service account:

```text
Customer Profile -> Service Order -> Service Account -> Customer Account
```

The module is not for system-login users, roles, or permissions. System-login access controls live in System Settings -> Access.

## Current Phase 1 Scope

- Show a Customer Accounts table with one row for every visible Customer Profile.
- Use Customer Profiling-style search, collapsible filters, and table tabs with badge counts.
- Show `All`, `Customer w/ Tickets`, and temporary `PPPoE & ONUs` tabs for now.
- The temporary `PPPoE & ONUs` tab lists every discovered MikroTik PPPoE account and shows the matched captured OLT ONU when one is found.
- Inside `PPPoE & ONUs`, inner tabs split rows into `PPPoE without ONUs` and `PPPoE with matched ONUs`.
- Show ticket count plus latest assigned ticket Category, Status, Priority, and action hints when a customer has Ticketing records. `INSTALLATION` currently exposes the intended `Create PPPoE Account` action gate.
- Show current account lifecycle, PPPoE account/status, router name, and assigned IP when available.
- Expose a temporary PPPoE-to-ONU mapping snapshot with one sample dummy customer profile attached to a matched PPPoE/ONU pair for review.

Network configuration forms, save actions, MikroTik refresh actions, PPPoE binding, WiFi/CPE editing, and provisioning requests are intentionally hidden from the page for this step.
Service Account and Installation Order columns are intentionally hidden from the `All` tab for this step.

## API

API prefix:

```text
/api/account-admin
```

Routes:

- `GET /api/account-admin/meta`
- `GET /api/account-admin/overview`
- `GET /api/account-admin/customer-accounts`
- `GET /api/account-admin/customer-accounts/{customer_id}`
- `GET /api/account-admin/pppoe-onu-mapping`

Legacy `/api/account-admin/accounts` system-login routes return `410 Gone` and direct users to System Settings -> Access.

## Dependencies

- Customer Profiling: source of customer identity and lifecycle.
- Service: source of Service Accounts and installation Service Orders.
- Ticketing: source of customer ticket assignment summaries.
- Network Settings: source of MikroTik PPPoE discovery and captured OLT ONU inventory.
- Future Network Settings provisioning endpoints: live PPPoE, WiFi/CPE, and other network configuration writes.

## Risks And Follow-Up

- Account records are derived from in-memory module sources and reset on API restart.
- Service does not yet expose a dedicated Activation Service Order type/status, so Phase 1 derives activation readiness from completed installation/service-account state.
- PPPoE-to-ONU matching deduplicates captured ONU rows by physical OLT/PON/ONU identity, then uses exact PPPoE caller ID/MAC to captured ONU MAC evidence first. It also treats same-OUI low-byte proximity as a high-confidence match when the tail delta is 8 or less and the PPPoE/ONU pair is the best mutual one-to-one candidate. A conservative metadata fallback remains for ONU identifiers in PPPoE comments/usernames. Rows without a match remain visible and are marked as unmatched.
- The sample customer profile is temporary module-local response data; it does not create a durable Customer Profiling record.
- Live MikroTik provisioning, PPPoE binding, WiFi/CPE writes, audit-grade sync history, and PostgreSQL persistence remain future phases. PPPoE creation should come next and must be gated by an eligible `INSTALLATION` ticket plus a Network Settings router-location binding match.
