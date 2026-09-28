import hashlib
import logging
import os
from datetime import datetime, timezone
from typing import Any

try:
    import psycopg
    from psycopg.rows import dict_row
except Exception:  # pragma: no cover - keeps local syntax checks independent of optional deps.
    psycopg = None
    dict_row = None


logger = logging.getLogger(__name__)

CUSTOMER_PROFILES_MIGRATION_ID = "2026052601_customer_profiles"
BILLING_RECORDS_MIGRATION_ID = "2026071001_billing_records"
SERVICE_RECORDS_MIGRATION_ID = "2026071002_service_records"
BILLING_INTEGRITY_MIGRATION_ID = "2026071401_billing_financial_integrity"
COLLECTOR_RECORDS_MIGRATION_ID = "2026072801_collector_records"
POS_RECORDS_MIGRATION_ID = "2026080301_pos_records"
INVENTORY_FOUNDATION_MIGRATION_ID = "2026080302_inventory_foundation"
SUBSCRIBER_MIGRATION_BATCHES_MIGRATION_ID = "2026091601_subscriber_migration_batches"

MIGRATIONS: list[dict[str, Any]] = [
    {
        "id": CUSTOMER_PROFILES_MIGRATION_ID,
        "description": "Create Customer Profiling durable customer_profiles table",
        "statements": [
            """
            CREATE TABLE IF NOT EXISTS customer_profiles (
                id text PRIMARY KEY,
                account_number text,
                full_name text NOT NULL DEFAULT '',
                customer_type text NOT NULL DEFAULT '',
                status text NOT NULL DEFAULT '',
                gender text NOT NULL DEFAULT '',
                province text NOT NULL DEFAULT '',
                city text NOT NULL DEFAULT '',
                barangay text NOT NULL DEFAULT '',
                contact_number text NOT NULL DEFAULT '',
                email text NOT NULL DEFAULT '',
                location_id text NOT NULL DEFAULT '',
                data jsonb NOT NULL,
                created_at timestamptz NOT NULL,
                updated_at timestamptz NOT NULL,
                deleted_at timestamptz,
                created_by_user_id text,
                updated_by_user_id text
            )
            """,
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_profiles_account_active
            ON customer_profiles (account_number)
            WHERE deleted_at IS NULL
            """,
            "CREATE INDEX IF NOT EXISTS idx_customer_profiles_deleted_at ON customer_profiles (deleted_at)",
            "CREATE INDEX IF NOT EXISTS idx_customer_profiles_status ON customer_profiles (status)",
            "CREATE INDEX IF NOT EXISTS idx_customer_profiles_type ON customer_profiles (customer_type)",
            "CREATE INDEX IF NOT EXISTS idx_customer_profiles_location ON customer_profiles (province, city, barangay)",
        ],
    },
    {
        "id": BILLING_RECORDS_MIGRATION_ID,
        "description": "Create Billing durable billing_records table",
        "statements": [
            """
            CREATE TABLE IF NOT EXISTS billing_records (
                record_type text NOT NULL,
                record_id text NOT NULL,
                customer_id text NOT NULL DEFAULT '',
                service_account_id text NOT NULL DEFAULT '',
                invoice_id text NOT NULL DEFAULT '',
                status text NOT NULL DEFAULT '',
                data jsonb NOT NULL,
                created_at timestamptz NOT NULL,
                updated_at timestamptz NOT NULL,
                deleted_at timestamptz,
                created_by_user_id text,
                updated_by_user_id text,
                PRIMARY KEY (record_type, record_id)
            )
            """,
            "CREATE INDEX IF NOT EXISTS idx_billing_records_type_deleted ON billing_records (record_type, deleted_at)",
            "CREATE INDEX IF NOT EXISTS idx_billing_records_customer ON billing_records (customer_id)",
            "CREATE INDEX IF NOT EXISTS idx_billing_records_service_account ON billing_records (service_account_id)",
            "CREATE INDEX IF NOT EXISTS idx_billing_records_invoice ON billing_records (invoice_id)",
            "CREATE INDEX IF NOT EXISTS idx_billing_records_status ON billing_records (record_type, status)",
            "CREATE INDEX IF NOT EXISTS idx_billing_records_updated ON billing_records (updated_at DESC)",
        ],
    },
    {
        "id": BILLING_INTEGRITY_MIGRATION_ID,
        "description": "Add Billing posting integrity constraints, document sequences, and durable events",
        "statements": [
            "ALTER TABLE billing_records ADD COLUMN IF NOT EXISTS document_number text NOT NULL DEFAULT ''",
            "ALTER TABLE billing_records ADD COLUMN IF NOT EXISTS subscription_id text NOT NULL DEFAULT ''",
            "ALTER TABLE billing_records ADD COLUMN IF NOT EXISTS billing_cycle_start date",
            "ALTER TABLE billing_records ADD COLUMN IF NOT EXISTS idempotency_key text NOT NULL DEFAULT ''",
            """
            UPDATE billing_records
            SET
                document_number = CASE
                    WHEN record_type = 'invoice' THEN COALESCE(data->>'invoiceNumber', '')
                    WHEN record_type = 'payment' THEN COALESCE(data->>'receiptNumber', '')
                    ELSE ''
                END,
                subscription_id = COALESCE(data->>'subscriptionId', ''),
                billing_cycle_start = CASE
                    WHEN COALESCE(data->>'billingCycleStart', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                    THEN (data->>'billingCycleStart')::date
                    ELSE NULL
                END,
                idempotency_key = COALESCE(data->>'idempotencyKey', '')
            """,
            "CREATE SEQUENCE IF NOT EXISTS billing_invoice_document_seq AS bigint START WITH 1",
            "CREATE SEQUENCE IF NOT EXISTS billing_receipt_document_seq AS bigint START WITH 1",
            """
            SELECT setval(
                'billing_invoice_document_seq',
                GREATEST(COALESCE(MAX(NULLIF(substring(document_number FROM '([0-9]+)$'), '')::bigint), 0), 1),
                COALESCE(MAX(NULLIF(substring(document_number FROM '([0-9]+)$'), '')::bigint), 0) > 0
            )
            FROM billing_records
            WHERE record_type = 'invoice'
            """,
            """
            SELECT setval(
                'billing_receipt_document_seq',
                GREATEST(COALESCE(MAX(NULLIF(substring(document_number FROM '([0-9]+)$'), '')::bigint), 0), 1),
                COALESCE(MAX(NULLIF(substring(document_number FROM '([0-9]+)$'), '')::bigint), 0) > 0
            )
            FROM billing_records
            WHERE record_type = 'payment'
            """,
            """
            CREATE TABLE IF NOT EXISTS billing_posting_events (
                id text PRIMARY KEY,
                operation_id text NOT NULL,
                event_type text NOT NULL,
                target_type text NOT NULL,
                target_id text NOT NULL,
                actor text NOT NULL,
                details jsonb NOT NULL DEFAULT '{}'::jsonb,
                created_at timestamptz NOT NULL DEFAULT now()
            )
            """,
            "CREATE INDEX IF NOT EXISTS idx_billing_records_document_number ON billing_records (record_type, document_number)",
            "CREATE INDEX IF NOT EXISTS idx_billing_records_subscription_cycle ON billing_records (subscription_id, billing_cycle_start)",
            "CREATE INDEX IF NOT EXISTS idx_billing_posting_events_operation ON billing_posting_events (operation_id)",
            "CREATE INDEX IF NOT EXISTS idx_billing_posting_events_target ON billing_posting_events (target_type, target_id, created_at DESC)",
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_records_document_number
            ON billing_records (record_type, document_number)
            WHERE document_number <> ''
            """,
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_records_idempotency
            ON billing_records (record_type, idempotency_key)
            WHERE idempotency_key <> ''
            """,
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_invoice_subscription_cycle
            ON billing_records (subscription_id, billing_cycle_start)
            WHERE record_type = 'invoice'
              AND subscription_id <> ''
              AND billing_cycle_start IS NOT NULL
            """,
        ],
    },
    {
        "id": SERVICE_RECORDS_MIGRATION_ID,
        "description": "Create Service durable service_records table",
        "statements": [
            """
            CREATE TABLE IF NOT EXISTS service_records (
                record_type text NOT NULL,
                record_id text NOT NULL,
                customer_id text NOT NULL DEFAULT '',
                service_account_id text NOT NULL DEFAULT '',
                catalog_id text NOT NULL DEFAULT '',
                order_number text NOT NULL DEFAULT '',
                status text NOT NULL DEFAULT '',
                data jsonb NOT NULL,
                created_at timestamptz NOT NULL,
                updated_at timestamptz NOT NULL,
                deleted_at timestamptz,
                created_by_user_id text,
                updated_by_user_id text,
                PRIMARY KEY (record_type, record_id)
            )
            """,
            "CREATE INDEX IF NOT EXISTS idx_service_records_type_deleted ON service_records (record_type, deleted_at)",
            "CREATE INDEX IF NOT EXISTS idx_service_records_customer ON service_records (customer_id)",
            "CREATE INDEX IF NOT EXISTS idx_service_records_service_account ON service_records (service_account_id)",
            "CREATE INDEX IF NOT EXISTS idx_service_records_catalog ON service_records (catalog_id)",
            "CREATE INDEX IF NOT EXISTS idx_service_records_order_number ON service_records (order_number)",
            "CREATE INDEX IF NOT EXISTS idx_service_records_status ON service_records (record_type, status)",
            "CREATE INDEX IF NOT EXISTS idx_service_records_updated ON service_records (updated_at DESC)",
        ],
    },
    {
        "id": COLLECTOR_RECORDS_MIGRATION_ID,
        "description": "Create durable Collector claims, collection custody, and remittance records",
        "statements": [
            """
            CREATE TABLE IF NOT EXISTS collector_records (
                record_type text NOT NULL,
                record_id text NOT NULL,
                collector_username text NOT NULL DEFAULT '',
                customer_id text NOT NULL DEFAULT '',
                billing_payment_id text NOT NULL DEFAULT '',
                status text NOT NULL DEFAULT '',
                method text NOT NULL DEFAULT '',
                reference_number text NOT NULL DEFAULT '',
                idempotency_key text NOT NULL DEFAULT '',
                data jsonb NOT NULL,
                created_at timestamptz NOT NULL,
                updated_at timestamptz NOT NULL,
                deleted_at timestamptz,
                PRIMARY KEY (record_type, record_id)
            )
            """,
            "CREATE INDEX IF NOT EXISTS idx_collector_records_type_status ON collector_records (record_type, status)",
            "CREATE INDEX IF NOT EXISTS idx_collector_records_collector ON collector_records (collector_username, created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_collector_records_customer ON collector_records (customer_id, created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_collector_records_billing_payment ON collector_records (billing_payment_id)",
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_collector_record_idempotency
            ON collector_records (record_type, idempotency_key)
            WHERE record_type = 'collection' AND idempotency_key <> ''
            """,
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_collector_gcash_reference
            ON collector_records (lower(reference_number))
            WHERE record_type = 'collection'
              AND method = 'GCASH'
              AND status = 'POSTED'
              AND reference_number <> ''
              AND deleted_at IS NULL
            """,
        ],
    },
    {
        "id": POS_RECORDS_MIGRATION_ID,
        "description": "Create durable Point of Sale register records",
        "statements": [
            """
            CREATE TABLE IF NOT EXISTS pos_records (
                record_type text NOT NULL,
                record_id text NOT NULL,
                document_number text NOT NULL DEFAULT '',
                cashier_username text NOT NULL DEFAULT '',
                customer_id text NOT NULL DEFAULT '',
                sale_id text NOT NULL DEFAULT '',
                status text NOT NULL DEFAULT '',
                method text NOT NULL DEFAULT '',
                idempotency_key text NOT NULL DEFAULT '',
                data jsonb NOT NULL,
                created_at timestamptz NOT NULL,
                updated_at timestamptz NOT NULL,
                deleted_at timestamptz,
                PRIMARY KEY (record_type, record_id)
            )
            """,
            "CREATE INDEX IF NOT EXISTS idx_pos_records_type_status ON pos_records (record_type, status)",
            "CREATE INDEX IF NOT EXISTS idx_pos_records_cashier ON pos_records (cashier_username, created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_pos_records_customer ON pos_records (customer_id, created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_pos_records_sale ON pos_records (sale_id)",
            "CREATE INDEX IF NOT EXISTS idx_pos_records_document ON pos_records (record_type, document_number)",
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_sale_idempotency
            ON pos_records (record_type, idempotency_key)
            WHERE record_type = 'sale' AND idempotency_key <> ''
            """,
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_document_number
            ON pos_records (record_type, document_number)
            WHERE record_type IN ('session', 'sale', 'payment') AND document_number <> ''
            """,
        ],
    },
    {
        "id": INVENTORY_FOUNDATION_MIGRATION_ID,
        "description": "Create durable Inventory item, location, balance, assignment, and immutable movement ledger tables",
        "statements": [
            """
            CREATE TABLE IF NOT EXISTS inventory_locations (
                id text PRIMARY KEY,
                code text NOT NULL,
                name text NOT NULL,
                location_type text NOT NULL,
                parent_location_id text REFERENCES inventory_locations(id) ON DELETE RESTRICT,
                active boolean NOT NULL DEFAULT true,
                data jsonb NOT NULL DEFAULT '{}'::jsonb,
                created_at timestamptz NOT NULL,
                updated_at timestamptz NOT NULL,
                archived_at timestamptz,
                CONSTRAINT ck_inventory_location_type CHECK (
                    location_type IN ('WAREHOUSE', 'STOCKROOM', 'BIN', 'VEHICLE', 'TRANSIT', 'CUSTOMER', 'DAMAGED', 'VIRTUAL')
                )
            )
            """,
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_location_code ON inventory_locations (lower(code))",
            "CREATE INDEX IF NOT EXISTS idx_inventory_locations_parent ON inventory_locations (parent_location_id)",
            "CREATE INDEX IF NOT EXISTS idx_inventory_locations_active_type ON inventory_locations (active, location_type)",
            """
            CREATE TABLE IF NOT EXISTS inventory_items (
                id text PRIMARY KEY,
                sku text NOT NULL,
                name text NOT NULL,
                category text NOT NULL,
                tracking_type text NOT NULL,
                status text NOT NULL,
                default_location_id text REFERENCES inventory_locations(id) ON DELETE RESTRICT,
                data jsonb NOT NULL,
                created_at timestamptz NOT NULL,
                updated_at timestamptz NOT NULL,
                deleted_at timestamptz,
                CONSTRAINT ck_inventory_item_tracking CHECK (tracking_type IN ('STOCK', 'SERIALIZED', 'NON_STOCK')),
                CONSTRAINT ck_inventory_item_status CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED'))
            )
            """,
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_item_sku_active ON inventory_items (lower(sku)) WHERE deleted_at IS NULL",
            "CREATE INDEX IF NOT EXISTS idx_inventory_items_status ON inventory_items (status, deleted_at)",
            "CREATE INDEX IF NOT EXISTS idx_inventory_items_default_location ON inventory_items (default_location_id)",
            """
            CREATE TABLE IF NOT EXISTS inventory_stock_balances (
                item_id text NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
                location_id text NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
                quantity numeric(18, 4) NOT NULL DEFAULT 0,
                version bigint NOT NULL DEFAULT 0,
                updated_at timestamptz NOT NULL DEFAULT now(),
                PRIMARY KEY (item_id, location_id),
                CONSTRAINT ck_inventory_balance_nonnegative CHECK (quantity >= 0)
            )
            """,
            "CREATE INDEX IF NOT EXISTS idx_inventory_balances_location ON inventory_stock_balances (location_id, item_id)",
            """
            CREATE TABLE IF NOT EXISTS inventory_stock_movements (
                id text PRIMARY KEY,
                item_id text NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
                movement_type text NOT NULL,
                quantity numeric(18, 4) NOT NULL,
                serial_number text NOT NULL DEFAULT '',
                from_location_id text REFERENCES inventory_locations(id) ON DELETE RESTRICT,
                to_location_id text REFERENCES inventory_locations(id) ON DELETE RESTRICT,
                reference_type text NOT NULL DEFAULT 'MANUAL',
                reference_id text NOT NULL DEFAULT '',
                idempotency_key text NOT NULL,
                request_fingerprint text NOT NULL,
                reversal_of_id text REFERENCES inventory_stock_movements(id) ON DELETE RESTRICT,
                actor text NOT NULL,
                notes text NOT NULL DEFAULT '',
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT ck_inventory_movement_quantity CHECK (quantity > 0),
                CONSTRAINT ck_inventory_movement_type CHECK (movement_type IN ('RECEIVE', 'ISSUE', 'ADJUST', 'TRANSFER', 'RETURN')),
                CONSTRAINT ck_inventory_movement_locations CHECK (
                    (movement_type IN ('RECEIVE', 'RETURN') AND from_location_id IS NULL AND to_location_id IS NOT NULL)
                    OR (movement_type = 'ISSUE' AND from_location_id IS NOT NULL AND to_location_id IS NULL)
                    OR (movement_type = 'TRANSFER' AND from_location_id IS NOT NULL AND to_location_id IS NOT NULL AND from_location_id <> to_location_id)
                    OR (movement_type = 'ADJUST' AND ((from_location_id IS NULL) <> (to_location_id IS NULL)))
                )
            )
            """,
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_movement_idempotency ON inventory_stock_movements (idempotency_key)",
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_movement_reversal ON inventory_stock_movements (reversal_of_id) WHERE reversal_of_id IS NOT NULL",
            "CREATE INDEX IF NOT EXISTS idx_inventory_movements_item_created ON inventory_stock_movements (item_id, created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_inventory_movements_reference ON inventory_stock_movements (reference_type, reference_id)",
            "CREATE INDEX IF NOT EXISTS idx_inventory_movements_from_location ON inventory_stock_movements (from_location_id, created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_inventory_movements_to_location ON inventory_stock_movements (to_location_id, created_at DESC)",
            """
            CREATE TABLE IF NOT EXISTS inventory_assignments (
                id text PRIMARY KEY,
                item_id text NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
                serial_number text NOT NULL DEFAULT '',
                quantity numeric(18, 4) NOT NULL,
                assignee_type text NOT NULL,
                status text NOT NULL,
                customer_id text NOT NULL DEFAULT '',
                service_id text NOT NULL DEFAULT '',
                ticket_id text NOT NULL DEFAULT '',
                data jsonb NOT NULL,
                created_at timestamptz NOT NULL,
                updated_at timestamptz NOT NULL,
                deleted_at timestamptz,
                CONSTRAINT ck_inventory_assignment_quantity CHECK (quantity > 0),
                CONSTRAINT ck_inventory_assignment_status CHECK (status IN ('ASSIGNED', 'RETURNED', 'LOST', 'DAMAGED'))
            )
            """,
            "CREATE INDEX IF NOT EXISTS idx_inventory_assignments_item_status ON inventory_assignments (item_id, status, deleted_at)",
            "CREATE INDEX IF NOT EXISTS idx_inventory_assignments_customer ON inventory_assignments (customer_id, status)",
            "CREATE INDEX IF NOT EXISTS idx_inventory_assignments_service ON inventory_assignments (service_id, status)",
            "CREATE INDEX IF NOT EXISTS idx_inventory_assignments_ticket ON inventory_assignments (ticket_id, status)",
            """
            CREATE OR REPLACE FUNCTION reject_inventory_movement_mutation()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $$
            BEGIN
                RAISE EXCEPTION 'inventory_stock_movements is append-only; post a reversal instead'
                    USING ERRCODE = '55000';
            END;
            $$
            """,
            """
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_inventory_movements_immutable'
                ) THEN
                    CREATE TRIGGER trg_inventory_movements_immutable
                    BEFORE UPDATE OR DELETE ON inventory_stock_movements
                    FOR EACH ROW EXECUTE FUNCTION reject_inventory_movement_mutation();
                END IF;
            END;
            $$
            """,
            """
            INSERT INTO inventory_locations (id, code, name, location_type, active, data, created_at, updated_at)
            VALUES
                ('inventory-location-main', 'MAIN', 'Main stockroom', 'WAREHOUSE', true, '{}'::jsonb, now(), now()),
                ('inventory-location-transit', 'TRANSIT', 'In transit', 'TRANSIT', true, '{}'::jsonb, now(), now()),
                ('inventory-location-damaged', 'DAMAGED', 'Damaged and quarantine', 'DAMAGED', true, '{}'::jsonb, now(), now())
            ON CONFLICT (id) DO NOTHING
            """,
        ],
    },
    {
        "id": SUBSCRIBER_MIGRATION_BATCHES_MIGRATION_ID,
        "description": "Create durable existing-subscriber migration batches and row checkpoints",
        "statements": [
            """
            CREATE TABLE IF NOT EXISTS subscriber_migration_batches (
                id text PRIMARY KEY,
                filename text NOT NULL,
                file_hash text NOT NULL DEFAULT '',
                cutover_date date NOT NULL,
                status text NOT NULL,
                data jsonb NOT NULL DEFAULT '{}'::jsonb,
                created_at timestamptz NOT NULL,
                updated_at timestamptz NOT NULL,
                created_by_user_id text NOT NULL DEFAULT '',
                updated_by_user_id text NOT NULL DEFAULT ''
            )
            """,
            "CREATE INDEX IF NOT EXISTS idx_subscriber_migration_batches_status ON subscriber_migration_batches (status, updated_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_subscriber_migration_batches_file_hash ON subscriber_migration_batches (file_hash)",
            """
            CREATE TABLE IF NOT EXISTS subscriber_migration_rows (
                id text PRIMARY KEY,
                batch_id text NOT NULL REFERENCES subscriber_migration_batches(id) ON DELETE CASCADE,
                row_number integer NOT NULL,
                row_fingerprint text NOT NULL,
                status text NOT NULL,
                data jsonb NOT NULL,
                result jsonb NOT NULL DEFAULT '{}'::jsonb,
                error text NOT NULL DEFAULT '',
                created_at timestamptz NOT NULL,
                updated_at timestamptz NOT NULL,
                UNIQUE (batch_id, row_number)
            )
            """,
            "CREATE INDEX IF NOT EXISTS idx_subscriber_migration_rows_batch_status ON subscriber_migration_rows (batch_id, status, row_number)",
            "CREATE INDEX IF NOT EXISTS idx_subscriber_migration_rows_fingerprint ON subscriber_migration_rows (row_fingerprint)",
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriber_migration_imported_line
            ON subscriber_migration_rows (row_fingerprint)
            WHERE status = 'IMPORTED'
            """,
        ],
    },
]

_migration_status: dict[str, Any] = {
    "enabled": bool(os.getenv("DATABASE_URL", "").strip()),
    "ready": False,
    "lastRunAt": None,
    "appliedThisRun": [],
    "knownMigrations": [migration["id"] for migration in MIGRATIONS],
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _migration_checksum(statements: list[str]) -> str:
    normalized = "\n\n".join(statement.strip() for statement in statements)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _connect(database_url: str):
    if psycopg is None or dict_row is None:
        raise RuntimeError("PostgreSQL migration driver is not installed")
    return psycopg.connect(database_url, row_factory=dict_row)


def run_database_migrations() -> dict[str, Any]:
    global _migration_status
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        _migration_status = {
            "enabled": False,
            "ready": False,
            "lastRunAt": _now_iso(),
            "appliedThisRun": [],
            "knownMigrations": [migration["id"] for migration in MIGRATIONS],
            "message": "DATABASE_URL is not configured; database migrations skipped.",
        }
        return _migration_status

    applied_this_run: list[str] = []
    migration_rows: list[dict[str, Any]] = []
    try:
        with _connect(database_url) as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS schema_migrations (
                        id text PRIMARY KEY,
                        description text NOT NULL,
                        checksum text NOT NULL,
                        applied_at timestamptz NOT NULL DEFAULT now()
                    )
                    """,
                )
                cursor.execute("SELECT id, description, checksum, applied_at FROM schema_migrations")
                existing = {row["id"]: row for row in cursor.fetchall()}

                for migration in MIGRATIONS:
                    migration_id = migration["id"]
                    checksum = _migration_checksum(migration["statements"])
                    existing_row = existing.get(migration_id)
                    if existing_row:
                        if existing_row["checksum"] != checksum:
                            raise RuntimeError(f"Migration checksum changed for {migration_id}")
                        continue

                    for statement in migration["statements"]:
                        cursor.execute(statement)
                    cursor.execute(
                        """
                        INSERT INTO schema_migrations (id, description, checksum)
                        VALUES (%s, %s, %s)
                        """,
                        (migration_id, migration["description"], checksum),
                    )
                    applied_this_run.append(migration_id)

                cursor.execute("SELECT id, description, checksum, applied_at FROM schema_migrations ORDER BY applied_at, id")
                migration_rows = [dict(row) for row in cursor.fetchall()]
            conn.commit()

        _migration_status = {
            "enabled": True,
            "ready": True,
            "lastRunAt": _now_iso(),
            "appliedThisRun": applied_this_run,
            "knownMigrations": [migration["id"] for migration in MIGRATIONS],
            "appliedMigrations": [
                {
                    "id": row["id"],
                    "description": row["description"],
                    "checksum": row["checksum"],
                    "appliedAt": row["applied_at"].isoformat() if hasattr(row["applied_at"], "isoformat") else row["applied_at"],
                }
                for row in migration_rows
            ],
        }
        return _migration_status
    except Exception as exc:
        logger.exception("Database migration failed")
        _migration_status = {
            "enabled": True,
            "ready": False,
            "lastRunAt": _now_iso(),
            "appliedThisRun": applied_this_run,
            "knownMigrations": [migration["id"] for migration in MIGRATIONS],
            "error": str(exc),
        }
        raise


def database_migration_status() -> dict[str, Any]:
    return dict(_migration_status)
