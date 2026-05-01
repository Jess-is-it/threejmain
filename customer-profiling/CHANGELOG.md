# Changelog

## 0.1.4 - 2026-02-13
- Changed account number generation to secure random 8-digit numeric values (no leading zero), with anti-pattern checks and DB uniqueness validation/retry.
- Regenerated existing customer account numbers to the new 8-digit secure format.
- Added duplicate-row detection within uploaded bulk files during validation/preview using:
  firstName, lastName, addressLine1, province, city, barangay, latitude, longitude.
- Duplicate rows in the same upload file are now flagged before upload with a validation error.
- Updated validated bulk-upload file export ordering to place invalid/error rows at the top for easier correction.
- Added duplicate-customer prevention on create and update using exact match of:
  firstName, lastName, addressLine1, province, city (municipality), barangay, latitude, longitude.
- Duplicate checks ignore soft-deleted records (`deletedAt` is null only).
- Added `POST /api/customer-profiling/v1/customers/bulk-upload-validated-report` to download a validated Excel copy of the uploaded file with an `Error` column per row.
- Added a `Download Validated File` action in the bulk upload modal to generate the validation report before upload.
- Updated bulk upload to allow partial processing: valid rows are created even when invalid rows exist.
- Added invalid-row Excel report generation on bulk upload completion, with an additional `Error` column and automatic client download.
- Updated bulk upload preview modal to show all rows with pagination and invalid rows prioritized at the top for faster review.
- Bulk upload now tolerates an additional `Error` column in uploaded files (ignored during validation/import as long as required template headers exist).
- Added optional `facebookProfileLink` support for `secondaryContacts[]` across API DTO validation, payload normalization, and customer create/edit form.
- Updated Customer Details view to display per-secondary-contact Facebook profile links as clickable external links when provided.
- Added dashboard overview API `GET /api/customer-profiling/v1/customers/overview` with KPI aggregates (total customers, Enrile total, distributions by province/city/barangay/customerType).
- Replaced placeholder overview page with live KPI cards, bar/pie charts, and municipality/barangay breakdown tables.
- Added bulk upload pre-validation endpoint (`POST /api/customer-profiling/v1/customers/bulk-upload-preview`) for template/header and row-level checks without inserting records.
- Updated bulk upload UI flow to validate file first, show valid/invalid row counts and row errors, then require explicit confirm before upload.
- Added bulk upload template download support via `GET /api/customer-profiling/v1/customers/bulk-upload-template`.
- Added a `Download XLS Template` action on the Customers list page to download a ready-to-fill Excel file.
- Enhanced bulk upload XLS template with dropdown validations for `province`, `city`, and `barangay` using allowed system values.
- Added support for multiple secondary contacts per customer using a JSON-backed array field.
- Updated customer create/edit API contract to accept `secondaryContacts[]` with name, contact number, facebook account, and relationship.
- Refactored the Customer Create/Edit form to add/remove multiple secondary contacts dynamically.
- Updated customer details page to render all secondary contacts.
- Kept backward compatibility by mapping legacy single-secondary-contact fields to/from the first item when present.

## 0.1.3 - 2026-02-12
- Refactored secondary contact into structured fields:
  - `secondaryContactName`
  - `secondaryContactNumber`
  - `secondaryContactFacebookAccount`
  - `secondaryContactRelationship`
- Updated Prisma model, API DTOs, and UI form/details rendering for the structured secondary contact.
- Added validation for optional secondary contact number format.

## 0.1.2 - 2026-02-12
- Added customer profile fields: `facebookAccountName`, `alternateMobileNumber`, and `secondaryContactPerson`.
- Wired new fields end-to-end across Prisma model, API DTOs, and Create/Edit/Details UI.
- Added validation for optional alternate mobile format in customer form.

## 0.1.1 - 2026-02-12
- Implemented Customer Create Form with production-ready validation using `react-hook-form` + `zod`.
- Added field-level validation messages for required customer identity, contact, and address fields.
- Added improved API error rendering for form submission failures.
- Kept create and edit paths aligned through one shared validated form component.

## 0.1.0 - 2026-02-12
- Initial standalone module setup for THREE3J Customer Profiling.
- Added NestJS + Prisma + PostgreSQL foundation with required base-path routing.
- Added customer, customer service, and audit log API scaffolding.
- Added correlation ID middleware, audit logging service, JWT/RBAC skeleton.
- Added Swagger and OpenAPI JSON at required module paths.
- Added React + Vite frontend shell from TailwindAdmin template and module pages.
- Added mandatory API, AI Prompt, and Updates pages.
- Added docker-compose stack (web + api + postgres) and deployment/docs templates.
- Added seed data with at least 5 customer records.
