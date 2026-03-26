#!/bin/bash
set -e

: "${TM_DB_HOST:=database}"
: "${TM_DB_PORT:=5432}"
: "${TM_DB_NAME:=teslamate}"
: "${TM_DB_USER:=teslamate}"
: "${TM_DB_PASS:?TM_DB_PASS is required}"
: "${TESLAHUB_READER_PASS:?TESLAHUB_READER_PASS is required}"
: "${TESLAHUB_APP_PASS:?TESLAHUB_APP_PASS is required}"

export PGHOST="$TM_DB_HOST"
export PGPORT="$TM_DB_PORT"
export PGUSER="$TM_DB_USER"
export PGPASSWORD="$TM_DB_PASS"

echo "[teslahub-init] Waiting for PostgreSQL at $PGHOST:$PGPORT..."
for i in $(seq 1 30); do
  if pg_isready -q 2>/dev/null; then break; fi
  sleep 2
done

if ! pg_isready -q 2>/dev/null; then
  echo "[teslahub-init] ERROR: PostgreSQL not reachable after 60s"
  exit 1
fi
echo "[teslahub-init] PostgreSQL is ready."

run_sql() { psql -d "$TM_DB_NAME" -tAc "$1" 2>/dev/null; }
run_sql_db() { psql -d "$1" -tAc "$2" 2>/dev/null; }

# --- teslahub_reader (read-only on TeslaMate DB) ---
if run_sql "SELECT 1 FROM pg_roles WHERE rolname='teslahub_reader'" | grep -q 1; then
  echo "[teslahub-init] Role teslahub_reader already exists — updating password."
  run_sql "ALTER USER teslahub_reader WITH PASSWORD '$TESLAHUB_READER_PASS';"
else
  echo "[teslahub-init] Creating role teslahub_reader..."
  run_sql "CREATE USER teslahub_reader WITH PASSWORD '$TESLAHUB_READER_PASS';"
fi

run_sql "GRANT CONNECT ON DATABASE $TM_DB_NAME TO teslahub_reader;"
run_sql "GRANT USAGE ON SCHEMA public TO teslahub_reader;"
run_sql "GRANT SELECT ON ALL TABLES IN SCHEMA public TO teslahub_reader;"
run_sql "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO teslahub_reader;"
echo "[teslahub-init] teslahub_reader configured on $TM_DB_NAME."

# --- teslahub database ---
if psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='teslahub'" | grep -q 1; then
  echo "[teslahub-init] Database teslahub already exists."
else
  echo "[teslahub-init] Creating database teslahub..."
  psql -d postgres -c "CREATE DATABASE teslahub;"
fi

# --- teslahub_app (full access on teslahub DB) ---
if run_sql "SELECT 1 FROM pg_roles WHERE rolname='teslahub_app'" | grep -q 1; then
  echo "[teslahub-init] Role teslahub_app already exists — updating password."
  run_sql "ALTER USER teslahub_app WITH PASSWORD '$TESLAHUB_APP_PASS';"
else
  echo "[teslahub-init] Creating role teslahub_app..."
  run_sql "CREATE USER teslahub_app WITH PASSWORD '$TESLAHUB_APP_PASS';"
fi

psql -d postgres -c "GRANT ALL PRIVILEGES ON DATABASE teslahub TO teslahub_app;"
run_sql_db "teslahub" "GRANT ALL ON SCHEMA public TO teslahub_app;"
echo "[teslahub-init] teslahub_app configured on teslahub database."

echo "[teslahub-init] Database initialization complete."
