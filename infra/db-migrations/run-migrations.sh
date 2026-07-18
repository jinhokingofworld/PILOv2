#!/bin/sh

set -eu

MIGRATIONS_DIR="${MIGRATIONS_DIR:-/opt/pilo/migrations}"
MIGRATION_MODE="${MIGRATION_MODE:-apply}"
BASELINE_THROUGH="${BASELINE_THROUGH:-}"
CONFIRM_BASELINE="${CONFIRM_BASELINE:-}"
MIGRATION_SOURCE_REVISION="${MIGRATION_SOURCE_REVISION:-unknown}"
BASELINE_VERIFY_SQL="${BASELINE_VERIFY_SQL:-}"
MIGRATION_LOCK_KEY="7420191212"
IMAGE_SOURCE_REVISION="$(cat /opt/pilo/source-revision 2>/dev/null || printf 'unknown')"

fail() {
  echo "migration_runner_error=$1" >&2
  exit 1
}

case "$MIGRATION_SOURCE_REVISION" in
  *[!A-Za-z0-9._/-]*) fail "MIGRATION_SOURCE_REVISION contains unsupported characters" ;;
esac

if [ "$MIGRATION_SOURCE_REVISION" != "unknown" ] \
  && [ "$IMAGE_SOURCE_REVISION" != "$MIGRATION_SOURCE_REVISION" ]; then
  fail "runner image revision does not match MIGRATION_SOURCE_REVISION"
fi

if [ -n "${DATABASE_URL:-}" ]; then
  DATABASE_DSN="$DATABASE_URL"
else
  : "${PGHOST:?PGHOST is required}"
  : "${PGPORT:=5432}"
  : "${PGDATABASE:?PGDATABASE is required}"
  : "${PGUSER:?PGUSER is required}"
  : "${PGPASSWORD:?PGPASSWORD is required}"
  : "${PGSSLMODE:=require}"
  DATABASE_DSN="host=$PGHOST port=$PGPORT dbname=$PGDATABASE user=$PGUSER sslmode=$PGSSLMODE"
fi

psql_db() {
  psql "$DATABASE_DSN" -X -v ON_ERROR_STOP=1 "$@"
}

has_top_level_transaction_control() {
  awk '
    BEGIN {
      dollar_tag = ""
      found = 0
    }
    {
      line = $0
      scan_from = 1
      while (match(substr(line, scan_from), /\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$/)) {
        token = substr(line, scan_from + RSTART - 1, RLENGTH)
        if (dollar_tag == "") {
          dollar_tag = token
        } else if (token == dollar_tag) {
          dollar_tag = ""
        }
        scan_from += RSTART + RLENGTH - 1
      }

      normalized = toupper(line)
      if (dollar_tag == "" && normalized ~ /^[[:space:]]*(BEGIN|COMMIT|ROLLBACK)[[:space:]]*;?[[:space:]]*(--.*)?$/) {
        found = 1
        exit
      }
    }
    END {
      exit(found ? 0 : 1)
    }
  ' "$1"
}

[ -d "$MIGRATIONS_DIR" ] || fail "migrations directory not found: $MIGRATIONS_DIR"

MIGRATION_LIST="$(mktemp)"
trap 'rm -f "$MIGRATION_LIST" "${CONTROL_SQL:-}" "${BASELINE_SQL:-}"' EXIT

find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '[0-9][0-9][0-9]_*.sql' \
  | sort > "$MIGRATION_LIST"

[ -s "$MIGRATION_LIST" ] || fail "no numbered migration files found"

previous_version=-1
while IFS= read -r migration_path; do
  migration_name="$(basename "$migration_path")"
  migration_version="${migration_name%%_*}"

  case "$migration_name" in
    [0-9][0-9][0-9]_[a-z0-9_]*.sql) ;;
    *) fail "invalid migration filename: $migration_name" ;;
  esac

  migration_number="$(expr "$migration_version" + 0)"
  [ "$migration_number" -gt "$previous_version" ] \
    || fail "duplicate or unordered migration version: $migration_version"
  previous_version="$migration_number"
done < "$MIGRATION_LIST"

psql_db <<'SQL'
BEGIN;
SELECT pg_advisory_xact_lock(7420191212);
CREATE SCHEMA IF NOT EXISTS pilo_migrations;
CREATE TABLE IF NOT EXISTS pilo_migrations.schema_migrations (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  name TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  execution_mode TEXT NOT NULL CHECK (execution_mode IN ('baseline', 'applied')),
  source_revision TEXT NOT NULL,
  applied_by TEXT NOT NULL DEFAULT current_user,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
REVOKE ALL ON SCHEMA pilo_migrations FROM PUBLIC;
REVOKE ALL ON TABLE pilo_migrations.schema_migrations FROM PUBLIC;
COMMIT;
SQL

run_baseline() {
  [ "$CONFIRM_BASELINE" = "RDS_SCHEMA_VERIFIED" ] \
    || fail "baseline requires CONFIRM_BASELINE=RDS_SCHEMA_VERIFIED"

  case "$BASELINE_THROUGH" in
    [0-9][0-9][0-9]) ;;
    *) fail "BASELINE_THROUGH must be a three-digit migration version" ;;
  esac

  baseline_number="$(expr "$BASELINE_THROUGH" + 0)"
  baseline_found=false
  BASELINE_SQL="$(mktemp)"

  if [ -z "$BASELINE_VERIFY_SQL" ]; then
    BASELINE_VERIFY_SQL="/opt/pilo/baselines/${BASELINE_THROUGH}.sql"
  fi
  [ -f "$BASELINE_VERIFY_SQL" ] \
    || fail "baseline verification SQL not found: $BASELINE_VERIFY_SQL"

  echo "migration_baseline_verification=$BASELINE_VERIFY_SQL"
  psql_db -f "$BASELINE_VERIFY_SQL"

  cat > "$BASELINE_SQL" <<SQL
BEGIN;
SELECT pg_advisory_xact_lock($MIGRATION_LOCK_KEY);
CREATE TEMP TABLE expected_pilo_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL
) ON COMMIT DROP;
INSERT INTO expected_pilo_migrations (version, name, checksum) VALUES
SQL

  first_value=true
  while IFS= read -r migration_path; do
    migration_name="$(basename "$migration_path")"
    migration_version="${migration_name%%_*}"
    migration_number="$(expr "$migration_version" + 0)"
    [ "$migration_number" -le "$baseline_number" ] || continue

    checksum="$(sha256sum "$migration_path" | awk '{print $1}')"
    if [ "$first_value" = true ]; then
      first_value=false
    else
      printf ',\n' >> "$BASELINE_SQL"
    fi
    printf "  (%s, '%s', '%s')" "$migration_number" "$migration_name" "$checksum" \
      >> "$BASELINE_SQL"

    if [ "$migration_version" = "$BASELINE_THROUGH" ]; then
      baseline_found=true
    fi
  done < "$MIGRATION_LIST"

  [ "$baseline_found" = true ] \
    || fail "baseline migration file not found: $BASELINE_THROUGH"

  cat >> "$BASELINE_SQL" <<SQL
;
DO \$baseline\$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pilo_migrations.schema_migrations applied
    INNER JOIN expected_pilo_migrations expected USING (version)
    WHERE applied.name <> expected.name
       OR applied.checksum <> expected.checksum
  ) THEN
    RAISE EXCEPTION 'Existing migration history does not match the baseline bundle';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pilo_migrations.schema_migrations applied
    WHERE applied.version <= $baseline_number
      AND NOT EXISTS (
        SELECT 1
        FROM expected_pilo_migrations expected
        WHERE expected.version = applied.version
      )
  ) THEN
    RAISE EXCEPTION 'Existing migration history contains an unknown baseline version';
  END IF;
END;
\$baseline\$;

INSERT INTO pilo_migrations.schema_migrations (
  version,
  name,
  checksum,
  execution_mode,
  source_revision
)
SELECT
  expected.version,
  expected.name,
  expected.checksum,
  'baseline',
  '$MIGRATION_SOURCE_REVISION'
FROM expected_pilo_migrations expected
ON CONFLICT (version) DO NOTHING;
COMMIT;
SQL

  psql_db -f "$BASELINE_SQL"
  baseline_count="$(
    psql_db -At -c \
      "SELECT count(*) FROM pilo_migrations.schema_migrations WHERE version <= $baseline_number"
  )"
  echo "migration_baseline_completed=$BASELINE_THROUGH"
  echo "migration_baseline_record_count=$baseline_count"
}

run_apply() {
  while IFS= read -r migration_path; do
    migration_name="$(basename "$migration_path")"
    migration_version="${migration_name%%_*}"
    migration_number="$(expr "$migration_version" + 0)"
    checksum="$(sha256sum "$migration_path" | awk '{print $1}')"

    applied_checksum="$(
      psql_db -At -c \
        "SELECT checksum FROM pilo_migrations.schema_migrations WHERE version = $migration_number"
    )"

    if [ -n "$applied_checksum" ]; then
      [ "$applied_checksum" = "$checksum" ] \
        || fail "checksum mismatch for applied migration: $migration_name"
      echo "migration_skipped=$migration_name"
      continue
    fi

    if has_top_level_transaction_control "$migration_path"; then
      fail "runner-managed migration must not contain transaction control: $migration_name"
    fi

    if grep -Eq '^[[:space:]]*\\' "$migration_path"; then
      fail "runner-managed migration must not contain psql meta-commands: $migration_name"
    fi

    CONTROL_SQL="$(mktemp)"
    cat > "$CONTROL_SQL" <<SQL
\set migration_version $migration_number
\set migration_name '$migration_name'
\set migration_checksum '$checksum'
\set migration_source_revision '$MIGRATION_SOURCE_REVISION'
BEGIN;
SELECT pg_advisory_xact_lock($MIGRATION_LOCK_KEY);
SELECT
  EXISTS (
    SELECT 1
    FROM pilo_migrations.schema_migrations
    WHERE version = :migration_version
  ) AS migration_applied,
  COALESCE((
    SELECT checksum = :'migration_checksum'
    FROM pilo_migrations.schema_migrations
    WHERE version = :migration_version
  ), false) AS checksum_matches
\gset
\if :migration_applied
  \if :checksum_matches
    \echo concurrent_migration_skipped=:$migration_name
  \else
    \echo concurrent_migration_checksum_mismatch=:$migration_name
    \quit 42
  \endif
\else
  \ir $migration_path
  INSERT INTO pilo_migrations.schema_migrations (
    version,
    name,
    checksum,
    execution_mode,
    source_revision
  ) VALUES (
    :migration_version,
    :'migration_name',
    :'migration_checksum',
    'applied',
    :'migration_source_revision'
  );
\endif
COMMIT;
SQL

    psql_db -f "$CONTROL_SQL"
    rm -f "$CONTROL_SQL"
    CONTROL_SQL=""
    echo "migration_applied=$migration_name"
  done < "$MIGRATION_LIST"

  applied_count="$(psql_db -At -c 'SELECT count(*) FROM pilo_migrations.schema_migrations')"
  bundled_count="$(wc -l < "$MIGRATION_LIST" | tr -d '[:space:]')"
  [ "$applied_count" = "$bundled_count" ] \
    || fail "migration history contains versions missing from the runner bundle"
  echo "migration_apply_completed=true"
  echo "migration_history_record_count=$applied_count"
}

case "$MIGRATION_MODE" in
  baseline) run_baseline ;;
  apply) run_apply ;;
  *) fail "MIGRATION_MODE must be baseline or apply" ;;
esac
