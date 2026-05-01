# THREE3J Customer Profiling System Prompt

Version: 0.1.4
Module: customer-profiling

This module is the source of truth for customer identity and service assignment in THREE3J ISP.

Key API base paths:
- API base: /api/customer-profiling
- API versioned base: /api/customer-profiling/v1
- Swagger: /api/customer-profiling/docs
- OpenAPI JSON: /api/customer-profiling/docs-json
- Health: /api/customer-profiling/health

Core entities:
- customers
- customer_services
- audit_logs

Integration notes:
- Uses MAIN_BASE_URL + module registry endpoint: /api/main-system/v1/modules/registry
- Supports correlation IDs through X-Correlation-Id
- Uses soft-delete for customers
- Maintains audit trail for customer and service assignment changes

Frontend mandatory pages included:
- API Page
- AI Prompt Page
- Updates Page

Current phase:
- Foundation setup complete
- Customer Create Form implemented with field-level validation and API error handling
- Multiple secondary contacts can now be captured per customer account
- Next tasks will continue per-epic hardening and behavior refinement
