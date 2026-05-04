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

- Ticket create, list/search/filter, detail, update, and soft-delete workflows.
- Ticket number, status, priority, category, source, due date, service ID, outage ID, assignment, and resolution fields.
- Customer Profiling lookup hooks with manual requestor/contact fallback.
- Free-text assignee placeholder until Account Admin staff records are integrated.
- Ticket notes with internal/customer-visible visibility.
- Metrics for total tickets, open tickets, urgent tickets, field jobs, and SLA risks.

See `PROJECT_MODULE_CONTEXT.md` for API routes, integration notes, dependencies, and risks.
