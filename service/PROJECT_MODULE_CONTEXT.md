# Service Module Context

## Purpose

Service manages the ISP service catalog, service accounts, and service orders. The catalog answers what internet services the ISP offers. Service accounts represent actual customer internet lines/subscriptions. Service orders answer what service request a customer is trying to avail.

## Current Status

- Status from `module.json`: `functional-shell`
- App-shell routes: `/service/catalog`, `/service/order`
- API prefix: `/api/service`
- Frontend entry: `service/web/ServicePage.jsx`
- API entry: `service/api/service/router.py`

## Current CRUD Scope

- Service Catalog speed plan CRUD with service type, target segment, speeds, monthly rate, install fee, billing mode, status, contract months, and equipment profile.
- Phase 2 Service Account CRUD/API with customer lookup, selected catalog item, service address, service account number, service reference, activation date, lifecycle status, and notes.
- Phase 2 Service Account statuses are `PENDING_ACTIVATION`, `ACTIVE`, `SUSPENDED`, `DISCONNECTED`, and `CANCELLED`.
- Service Order CRUD with customer lookup, Service Order Type, selected catalog item, request dates, priority, install address, notes, and system-owned workflow status/service reference fields.
- Phase 3 links Service Orders to Service Accounts through `serviceAccountId`. `NEW_INSTALLATION` can start without a Service Account and creates/activates one when completed. All other Service Order types require an existing Service Account.
- Phase 3 blocks multiple open Service Orders for the same Service Account. Completed account-affecting orders update the account: plan upgrade/downgrade changes catalog, relocation changes service address, temporary suspension marks suspended, reconnection marks active, disconnection marks disconnected, and change ownership moves the Service Account owner to the selected Customer Profiling record.
- Plan change validation compares the requested active internet catalog against the current Service Account plan. Plan Downgrade requires a lower plan and Plan Upgrade requires a higher plan, with speed used first and monthly rate as fallback when speed data is unavailable.
- Phase 4 adds structured `orderDetails` per Service Order type. The API sanitizes detail fields by schema and exposes `orderDetailSchemas` through `/api/service/meta`.
- Phase 5 marks required `orderDetails` in the schema, exposes `orderDetailRequiredStatuses` through `/api/service/meta`, returns `orderReadiness` in Service Order summaries, and blocks saving orders in `SUBMITTED`, `PENDING_REVIEW`, `APPROVED`, `IN_PROGRESS`, `COMPLETED`, or `ON_HOLD` when required type-specific details are missing. `DRAFT` and `PENDING_REQUIREMENT` can remain incomplete.
- Phase 1 Service Order types are `NEW_INSTALLATION`, `PLAN_UPGRADE`, `PLAN_DOWNGRADE`, `RELOCATION`, `TEMPORARY_SUSPENSION`, `RECONNECTION`, `DISCONNECTION`, `CHANGE_OWNERSHIP`, `ADD_ON_SERVICE`, and `EQUIPMENT_REPLACEMENT`.
- Phase 1 Service Order workflow statuses are `DRAFT`, `SUBMITTED`, `PENDING_REQUIREMENT`, `PENDING_REVIEW`, `APPROVED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `REJECTED`, and `ON_HOLD`.
- Service Order cancellation keeps the order visible as a historical `CANCELLED` record and stores `cancelledAt`; it no longer sets `deletedAt`.
- Creating a new Service Order now automatically creates a linked Ticketing ticket through the app-shell-provided Ticketing helper. The returned `ticketId`, `ticketNumber`, `ticketStatus`, and ticket snapshot are stored on the Service Order summary.
- Customer snapshots include `gender` from Customer Profiling so System Settings can resolve male/female avatars.

## Frontend Notes

- Service Catalog and Service Order are separate app-shell pages, not tabs within the Service module page. The Service Catalog table has a dedicated Service Catalog Type column, and the form adapts by catalog type so internet plans show speed/install/contract fields, add-ons show add-on pricing/provisioning fields, and one-time installation items show setup pricing.
- Create and edit forms open as modal dialogs from the table header `New` actions and row edit buttons.
- Service Order uses one account table, sorted with highlighted customers that do not have a Service Account first. KPIs show Service Accounts and customers without Service Accounts, filters can narrow to non-service accounts, order type, and workflow status, and no-service rows use an icon-only badge action to launch Service Order creation for that customer. Existing Service Account rows also expose a table-level plus action to create a new Service Order directly for that account, beside the eye action for viewing details. The Service Accounts header has visible search/show-entry controls, a collapsed Filter-button panel for account/order filters, and a `Service Order` button that opens a customer-search picker. New Service Order creation is a single Customer Profiling-style staged modal with Customer, Order Type, Order, Service Catalog, Ticket, and Review stages plus pinned bottom Previous on the left and Cancel/Next/Save actions on the right. The Ticket stage previews the Ticketing record that will be created automatically on save. The Customer stage has search plus location and account-type filters; customer rows show an avatar, customer label, and barangay/municipality only, while selected-customer cards show avatar, customer label, full customer address, customer status, and all Service Order records for that customer without contact, account-type badges, or service account summaries. Order Type is intentionally unselected until the user chooses a card; card descriptions are hover tooltips and the selected type shows a green check. Progress starts at 0% and advances only after stages are completed; the Review stage requires explicit confirmation before Save is enabled. Non-installation order types require a target Service Account in the order-type step; New Installation remains available for customers without service and creates an additional service line for customers who already have one. Plan Downgrade auto-detects the active Service Catalog and is disabled in the type picker when none of the customer's selected/available service accounts has a lower active internet plan; adding a lower active plan re-enables the type. The modal shows the selected customer and, when applicable, selected Service Account in read-only cards above the Order, Service catalog, Ticket, and Review stages. The modal header displays the selected Service Order Type with a matching icon, so the Order stage no longer repeats a Service Order Type selector. The Order stage fields are grouped in a bordered Order Information panel and now collect type-specific required details before the user can continue. The generic Installation Address field appears only for New Installation; Relocation, Change Ownership, Suspension, Reconnection, Disconnection, Add-on, and Equipment Replacement use their own relevant fields. Change Ownership selects the new owner from Customer Profiling and stores the selected owner snapshot. Current-state and catalog-derived fields are display-only during intake: current plan, current service address, catalog-selected installation fee, computed plan price difference, selected add-on name, selected add-on monthly charge, and generated Change Ownership customer snapshot fields. Workflow Status, Service Reference, and actual Activation Date are not editable from the modal and should be updated by system workflow/ticket completion. Service catalog selection appears only for `NEW_INSTALLATION`, `PLAN_UPGRADE`, `PLAN_DOWNGRADE`, and `ADD_ON_SERVICE`; account-operation order types keep the current Service Account catalog through a read-only catalog stage. Required detail fields are status-aware in saved readiness data and are enforced during guided intake before reaching Review. Service tables use zebra rows and responsive column hiding while keeping the action column visible. Clicking any account switches from the full table into a threejmon Under Surveillance-style split view: compact account list on the left and a Service Account detail card, selected Service Order detail card, or no-service customer detail card on the right. Service Account detail has a `New Service Order` action that starts from that account context before type selection. Service Order detail displays the saved type-specific details, linked Ticketing ticket, and readiness status. Service account row actions use an eye icon to view a matching service order when available; the close action returns to the full table.
- The Service Accounts table is customer-account centered: one row per customer, no contact-number column, service account count and current service in the row, and the Service Orders column shows the latest service order token plus a `+N` count for older orders. Selecting a customer opens a customer-first side panel with customer details, service accounts, and expandable service order records instead of a single-order-only detail panel.
- Service customer rows, customer picker cards, and service/no-service detail cards use `CustomerEmotionAvatar` from System Settings. Mood scoring considers customer status, service account status, whether the customer has service, and open/completed service orders.
- The Service Order staged modal uses a fixed viewport-constrained height with a stable fixed-height bottom action band. The Customer stage search field has an inline clear button, while modal body content scrolls instead of resizing the dialog or footer controls.

## Backend Notes

- Router package: `service/api/service`
- In-memory lists: `service_catalog`, `service_accounts`, `service_orders`
- Customer snapshots from `/api/service/customers` include `customerType`, `barangay`, `city`, and `province` so Service Order customer selection can filter and display Customer Profiling account/location metadata.
- Configuration hook: `configure_service(current_admin, audit_logger, customer_resolver, customer_searcher, customer_seed)`
- Metrics hook: `service_metrics()`
- Seed hook: `seed_service_data()`

## Integration Notes

- Customer Profiling is the customer identity source. Service calls customer provider hooks from `app-shell/api/app/main.py`.
- Customer Profiling should not create service assignments. It can display Service-owned accounts through `/api/service/accounts?customerId=...` and orders through `/api/service/orders?customerId=...`.
- Billing subscriptions should eventually use Service Account as the subscription target. Phase 2 still keeps existing Service Order references available for compatibility.
- Ticketing can use a Service Account plus Service Order to tag the affected line/request. New Service Orders call the Ticketing helper supplied by app-shell and store the linked ticket reference.
- Inventory and installation/field-job flows should use Service Account and Service Order references when those workflows are expanded.

## Risks And Follow-Up Work

- Current records are in memory and reset on API restart.
- Durable PostgreSQL persistence and migrations are required before production.
- Role/permission boundaries for catalog management versus order intake still need enforcement.
- Service Order lifecycle should later drive installation scheduling, inventory assignment, and billing activation events.
