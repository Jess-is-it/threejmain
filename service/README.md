# Service

Service owns the ISP-facing definition of offered internet services, customer service accounts/subscriptions, and the customer-facing order records for service-related requests.

## Routes

- Web: `/service/catalog`
- Web: `/service/order`
- API prefix: `/api/service`

## Current CRUD Scope

- Service Catalog: create, update, list, and archive speed plans and service items.
- Service Account: create, update, list, and archive customer internet lines/subscriptions with current catalog item, service address, account number, service reference, activation date, and lifecycle status.
- Service Order: create, update, list, and cancel customer service orders with a request type and workflow status. Cancelled orders remain visible as historical records.
- Customer lookup: Service Order uses Customer Profiling as the source of customer identity.
- Cross-module references: Service Order IDs and service references are exposed for Billing subscriptions and Ticketing tickets. Creating a Service Order now automatically creates a linked Ticketing ticket and stores the ticket reference on the Service Order.
- Customer avatar behavior: Service customer views use System Settings `CustomerEmotionAvatar`; service account status and service order state affect the displayed mood.

## Service Order Phase 1 Workflow

Service Order now represents general service-related customer requests, not only new installation. Current order types are New Installation, Plan Upgrade, Plan Downgrade, Relocation, Temporary Suspension, Reconnection, Disconnection, Change Ownership, Add-on Service, and Equipment Replacement.

Current workflow statuses are Draft, Submitted, Pending Requirement, Pending Review, Approved, In Progress, Completed, Cancelled, Rejected, and On Hold.

## Service Account Phase 2 Model

Service Account now represents the customer's actual internet line/subscription. It is separate from Service Order history, so one customer can later own multiple service accounts and each service account can have many service orders.

Current service account statuses are Pending Activation, Active, Suspended, Disconnected, and Cancelled.

## Service Order Phase 3 Account Link

Service Orders now support `serviceAccountId`. New Installation orders may start without an existing account and will create or activate a Service Account when completed. Other order types require an existing Service Account so the request is tied to the exact internet line/subscription.

Only one open Service Order is allowed per Service Account at a time. Completed Plan Upgrade/Downgrade orders update the account catalog, Relocation updates the account address, Temporary Suspension marks the account Suspended, Reconnection marks it Active, and Disconnection marks it Disconnected.

## Service Order Phase 4 Type Details

Service Orders now include structured `orderDetails` keyed by order type. The API sanitizes the fields for each request type and exposes the schema in `/api/service/meta` as `orderDetailSchemas`.

The Service Order modal shows a type-specific section for New Installation, Plan Upgrade/Downgrade, Relocation, Temporary Suspension, Reconnection, Disconnection, Change Ownership, Add-on Service, and Equipment Replacement. Saved details also appear in the Service Order detail panel.

## Service Order Phase 5 Readiness Validation

Required `orderDetails` are now enforced when an order moves beyond early intake statuses. Draft and Pending Requirement orders may remain incomplete, while Submitted, Pending Review, Approved, In Progress, Completed, and On Hold orders must have required type-specific details before saving.

The API exposes `orderDetailRequiredStatuses` in `/api/service/meta` and includes `orderReadiness` in each Service Order summary. The Service Order modal marks required fields for the current status, blocks incomplete saves, and the detail panel shows whether the order is ready for processing.

## Service Order Modal Rules

The Service Order creation modal is organized as a guided staged flow, similar to Customer Profiling creation: Customer, Order Type, Order, Service Catalog, Ticket, and Review. The modal uses a fixed viewport-constrained height so the dialog does not resize when stage content changes, and its bottom action band has a stable fixed height. Order Type starts unselected, card descriptions appear as hover tooltips, and the selected order type shows a green check mark. Progress starts at 0% and advances only after a stage is completed. Cancel, Previous, Next, and Save actions stay pinned at the bottom of the modal so the user does not need to scroll to proceed. The Order stage collects only fields relevant to the selected order type: New Installation shows Installation Address, Plan Upgrade/Downgrade collect effective date and plan-change details, Relocation collects current/new service address and target transfer date, Change Ownership selects the new owner from Customer Profiling, Suspension/Reconnection/Disconnection collect their own operational dates/reasons/balance fields, Add-on collects provisioning details, and Equipment Replacement collects replacement details. Service catalog selection appears only when the order type needs a catalog decision: New Installation, Plan Upgrade, Plan Downgrade, and Add-on Service. Account-operation orders such as Relocation, Suspension, Reconnection, Disconnection, Change Ownership, and Equipment Replacement keep the existing Service Account catalog through a read-only catalog stage. The Ticket stage previews the operations ticket that Ticketing will create when the Service Order is saved. The Review stage requires confirmation before Save is enabled.

Current-state and catalog-derived Service Order detail fields are read-only in the modal. This includes current plan, current service address, catalog-selected installation fee, computed plan price difference, selected add-on name, selected add-on monthly charge, and generated Change Ownership customer snapshot fields.

The Customer stage provides search with an inline clear button plus location and account-type filters. Customer rows show an avatar, customer label, and location as barangay plus municipality only. Selected customer cards show avatar, customer label, full customer address, customer status, and all Service Order records for that customer; contact numbers, account-type badges, and service account summaries are intentionally not shown in this stage.

The Service Accounts table in the Service Order page is customer-account centered. Each row represents one customer, hides the customer contact number, shows current service/account status context, and summarizes Service Orders as the latest service reference plus a `+N` badge for remaining orders. Opening a customer shows customer details first, then all Service Orders under that customer as expandable records.

Plan Downgrade is only available when the current active Service Catalog has a lower internet plan than the selected Service Account plan. If the customer is already on the lowest active plan, the type picker disables Plan Downgrade until a lower active plan is created. The API also rejects Plan Downgrade/Upgrade orders whose selected catalog item does not move lower/higher than the current Service Account plan.

The modal only collects intake fields. Workflow status, service reference, and actual activation date are system-owned fields and are not editable in the modal. Actual activation should be set later by fulfillment workflow events, such as ticket/work-order completion.

Change Ownership requires selecting a different Customer Profiling record as the new owner. On completed Change Ownership orders, the Service Account owner snapshot is moved to that selected customer.

Seed catalog data includes internet plans plus add-on items such as Static IP and Mesh WiFi so Add-on Service orders can select a relevant catalog item. The catalog form adapts by item type: internet plans show speed, install, and contract fields; add-ons show add-on pricing and provisioning fields; one-time installation items show setup pricing.

## API Endpoints

- `GET /api/service/health`
- `GET /api/service/meta`
- `GET /api/service/customers`
- `GET /api/service/accounts/overview`
- `GET /api/service/accounts`
- `POST /api/service/accounts`
- `PATCH /api/service/accounts/{account_id}`
- `DELETE /api/service/accounts/{account_id}`
- `GET /api/service/catalog/overview`
- `GET /api/service/catalog`
- `POST /api/service/catalog`
- `PATCH /api/service/catalog/{catalog_id}`
- `DELETE /api/service/catalog/{catalog_id}`
- `GET /api/service/orders/overview`
- `GET /api/service/orders`
- `POST /api/service/orders`
- `PATCH /api/service/orders/{order_id}`
- `DELETE /api/service/orders/{order_id}`

## Integration Notes

Customer Profiling no longer owns service assignment. It may display Service-owned accounts and orders for a selected customer, but creation and lifecycle changes belong here.

Billing should eventually subscribe against Service Account. Ticketing now receives an automatic ticket for each new Service Order through the shared app-shell wiring. Inventory and installation workflows should use Service Account plus Service Order references when those workflows are expanded.

The current implementation is in-memory for the first working shell. Shared PostgreSQL persistence should replace the in-memory lists before production use.
