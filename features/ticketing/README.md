# Ticketing

Ticketing owns trouble tickets, field dispatch, outage tracking, ticket notes, assignments, priorities, and resolution history.

The first module-local shell exposes in-memory Customer Ticketing CRUD for later registration in the shared app shell.

Current module files:

```text
ticketing/
  api/ticketing/__init__.py
  api/ticketing/router.py
  web/TicketingPage.jsx
  web/ticketing.css
  README.md
  module.json
  PROJECT_MODULE_CONTEXT.md
```

Current API prefix: `/api/ticketing`.

Implemented in this module:

- Ticket create, search/filter, detail, update, and soft-delete workflows.
- Status-based Kanban board where ticket cards can be moved between status columns.
- Category tabs for connectivity, billing, installation, equipment, outage, and general queues with badge counters.
- Modal-based create/edit ticket form instead of a persistent side panel.
- Ticket number, status, priority, category, source, due date, service ID, outage ID, assignment, and resolution fields.
- Service Order selection from the Service module to populate service references on tickets.
- Automatic ticket creation from new Service Orders, with Service Order ID/number/type and source module stored on the ticket.
- Tech Portal provider hooks for technician field status updates and internal notes.
- Compact priority-coded ticket cards that show status, ticket number, subject, and customer label for quick scanning.
- Right-side ticket detail drawer opened by clicking a card, with full ticket information, edit/delete actions, resolution details, and notes.
- Customer Profiling lookup hooks with manual requestor/contact fallback.
- Customer avatar behavior using System Settings `CustomerEmotionAvatar`; urgent/open/resolved tickets influence the displayed customer mood.
- Free-text assignee placeholder until Account Admin staff records are integrated.
- Ticket notes with internal/customer-visible visibility in the right-side ticket detail drawer.
- Metrics for total tickets, open tickets, urgent tickets, field jobs, and SLA risks.

See `PROJECT_MODULE_CONTEXT.md` for API routes, integration notes, dependencies, and risks.
