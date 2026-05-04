FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY app-shell/api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app-shell/api/app ./app
COPY customer-profiling/api/customer_profiling ./customer_profiling
COPY billing/api/billing ./billing
COPY point-of-sale/api/point_of_sale ./point_of_sale

EXPOSE 8100

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8100"]
