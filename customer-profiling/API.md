# API Reference

Base: `/api/customer-profiling/v1`

## Customers
- `GET /customers` list with server-side pagination/filter/sort/search
- `GET /customers/overview` dashboard KPIs and aggregate counts (total, Enrile, per province/city/barangay, customer type)
- `GET /customers/:id` get one
- `POST /customers` create
- `POST /customers/bulk-upload` bulk create via CSV/XLS/XLSX file (`multipart/form-data`, field name: `file`)
- `POST /customers/bulk-upload-preview` validate CSV/XLS/XLSX file format + row data only (no insert)
- `GET /customers/bulk-upload-template` download Excel template for bulk upload
- `PATCH /customers/:id` update
- `DELETE /customers/:id` soft delete
- `GET /customers/:id/services` list services for customer
- `POST /customers/:id/services` assign service

## Audit Logs
- `GET /audit-logs` list with server-side pagination/filter/sort/search

## Module Health / Docs
- `GET /api/customer-profiling/health`
- Swagger UI: `/api/customer-profiling/docs`
- OpenAPI JSON: `/api/customer-profiling/docs-json`

## Example
```bash
curl 'http://localhost:3000/api/customer-profiling/v1/customers?page=1&pageSize=10&search=ACCT'
```
