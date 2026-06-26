# Process Flow Module Context

## Purpose

Process Flow is a cross-system reference page that explains how major ISP workflows move through Customer Profiling, Service, Ticketing, Billing, Inventory, Network Settings, and Logs.

## Current Scope

- Static process-flow API under `/api/process-flow`.
- React pan/zoom canvas under `/process-flow`.
- Vertical topology diagrams with animated connectors.
- Flow selector for major processes:
  - New customer to active internet service
  - Customer with outstanding balance
  - New installation request
  - Plan upgrade or downgrade
  - Relocation
  - Temporary suspension and reconnection
  - Disconnection or termination
  - Equipment replacement
  - Add-on service
  - Change ownership
  - Network provisioning

## Data Model

The module stores process definitions in memory as documentation/reference data. It does not create transactions or modify source-of-truth modules.

## Integration Notes

- App-shell navigation places Process Flow below Dashboard.
- The frontend imports `features/process-flow/web/ProcessFlowPage.jsx`.
- The shared API imports `process_flow.router`.
- Docker and Vite allowlists must include the `process-flow` folder.

## Known Boundaries

- Process definitions are static in this phase.
- Future work can add role-specific process sets, editable process documentation, and links that deep-open module screens.
