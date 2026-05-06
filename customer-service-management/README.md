# Customer Service Management

Customer Service Management owns service requests, customer interactions, follow-ups, callbacks, notes, and care workflows.

The module is intended to be exposed at `/customer-service-management` when the integration branch wires it into the shared app shell.

## First CRUD Scope

- Service request CRUD for customer inquiries, complaints, billing concerns, service changes, retention work, and follow-ups.
- Customer interaction CRUD for calls, SMS, Facebook messages, email, walk-ins, field notes, and internal notes.
- Follow-up/callback CRUD for scheduled customer care actions.
- Overview metrics for open requests, callbacks due, SLA risks, and interactions today.

## Integration Notes

Customer Service Management depends on Customer Profiling for customer identity and lookup. The module API accepts optional customer resolver/search provider hooks. Until the shared shell wires those hooks, the module uses placeholder customer records so CRUD workflows can be developed independently.

Ticketing, Billing, and Inventory may later consume or link to CSM records for escalations, billing concerns, and field visits. Those links are placeholders in this first CRUD pass.
