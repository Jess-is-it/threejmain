# Customer Service Management

Customer Service Management owns service requests, customer interactions, omni-channel inbox conversations, follow-ups, callbacks, notes, and care workflows.

The module is intended to be exposed at `/customer-service-management` when the integration branch wires it into the shared app shell.

## First CRUD Scope

- Service request CRUD for customer inquiries, complaints, billing concerns, service changes, retention work, and follow-ups.
- Customer interaction CRUD for calls, SMS, Facebook messages, email, walk-ins, field notes, and internal notes.
- Follow-up/callback CRUD for scheduled customer care actions.
- Omni-channel inbox thread list/detail, status updates, mark-read, and threaded replies.
- Facebook settings for Page/App details, webhook verify token, Page access token, Graph API version, and notes.
- Overview metrics for open requests, callbacks due, SLA risks, interactions today, unread inbox messages, and Facebook threads.

## Channel Scope

Facebook Messenger is the first implemented connector:

- `GET /api/customer-service-management/channels/facebook/webhook` verifies Meta webhook setup.
- `POST /api/customer-service-management/channels/facebook/webhook` ingests Messenger text/postback events into the inbox.
- `POST /api/customer-service-management/omni-channel/inbox/{thread_id}/reply` stores replies locally and sends through Messenger when a Page access token is configured.

Telegram and WhatsApp are present as future channel cards in Settings, but they do not process messages yet.

## Integration Notes

Customer Service Management depends on Customer Profiling for customer identity and lookup. The module API accepts optional customer resolver/search provider hooks. Until the shared shell wires those hooks, the module uses placeholder customer records so CRUD workflows can be developed independently.

Ticketing, Billing, and Inventory may later consume or link to CSM records for escalations, billing concerns, and field visits. Those links are placeholders in this first CRUD pass.

Facebook production launch still needs a public HTTPS deployment URL, durable encrypted storage for Page tokens, Meta app review/permissions, and webhook signature verification.
