FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY app-shell/api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app-shell/api/app ./app
COPY features/customer-profiling/api/customer_profiling ./customer_profiling
COPY features/billing/api/billing ./billing
COPY features/point-of-sale/api/point_of_sale ./point_of_sale
COPY features/inventory/api/inventory ./inventory
COPY features/account-access-management/api/account_access_management ./account_access_management
COPY features/customer-service-management/api/customer_service_management ./customer_service_management
COPY features/ticketing/api/ticketing ./ticketing
COPY features/service/api/service ./service
COPY features/process-flow/api/process_flow ./process_flow
COPY features/network-settings/api/network_settings ./network_settings
COPY features/system-settings/api/system_settings ./system_settings
COPY features/logs/api/logs ./logs
COPY features/techportal/api/techportal ./techportal

EXPOSE 8100

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8100"]
