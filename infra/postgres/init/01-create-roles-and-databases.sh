#!/usr/bin/env bash
#
# Creates the database roles and databases for Agent Dashboard.
#
# Two roles keep the app from weakening its own safeguards:
#   - agent_dashboard_owner: owns the databases and schema, runs migrations.
#   - agent_dashboard_app:   used by the API at runtime. It only gets the table
#     privileges that migrations grant explicitly, so it cannot ALTER tables,
#     disable triggers or TRUNCATE, and the immutability triggers on
#     skill_versions and audit_log cannot be bypassed from the app.
#
# Runs automatically on first start of the Docker Compose Postgres container
# (docker-entrypoint-initdb.d). CI runs it directly against the service
# container. Connection settings come from the standard PG* variables.
#
# Required environment variables:
#   DB_OWNER_PASSWORD  password for agent_dashboard_owner
#   DB_APP_PASSWORD    password for agent_dashboard_app

set -euo pipefail

: "${DB_OWNER_PASSWORD:?DB_OWNER_PASSWORD must be set}"
: "${DB_APP_PASSWORD:?DB_APP_PASSWORD must be set}"

readonly OWNER_ROLE="agent_dashboard_owner"
readonly APP_ROLE="agent_dashboard_app"
readonly DATABASES=("agent_dashboard" "agent_dashboard_test")

run_psql() {
  psql --no-psqlrc -v ON_ERROR_STOP=1 --username "${POSTGRES_USER:-${PGUSER:-postgres}}" "$@"
}

# Passwords are passed as psql variables and quoted with :'name', so they are
# never interpolated into SQL by the shell.
run_psql --dbname postgres \
  -v owner_role="$OWNER_ROLE" -v app_role="$APP_ROLE" \
  -v owner_password="$DB_OWNER_PASSWORD" -v app_password="$DB_APP_PASSWORD" <<'SQL'
CREATE ROLE :"owner_role" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'owner_password';
CREATE ROLE :"app_role" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'app_password';
SQL

for database in "${DATABASES[@]}"; do
  run_psql --dbname postgres \
    -v database="$database" -v owner_role="$OWNER_ROLE" -v app_role="$APP_ROLE" <<'SQL'
CREATE DATABASE :"database" OWNER :"owner_role";
REVOKE ALL ON DATABASE :"database" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"database" TO :"app_role";
SQL

  # Since Postgres 15 the public schema belongs to the database owner, so the
  # owner role controls it. The app role may use it but never create objects.
  run_psql --dbname "$database" -v app_role="$APP_ROLE" <<'SQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"app_role";
SQL
done
