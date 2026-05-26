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
