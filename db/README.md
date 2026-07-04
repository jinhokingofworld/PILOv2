# PILO Database

The database schema source of truth is the migration history in `db/migrations/`.

## Folders

- `incoming/`: temporary source material from team members or schema tools.
- `migrations/`: ordered SQL migrations applied to local and shared databases.

## Rules

- Do not edit a migration after it has been applied to a shared database.
- Add a new migration for every later schema change.
- Keep generated diagrams or design exports in `incoming/`; do not apply them directly.
- Validate migrations against PostgreSQL before sharing them.

## Current Baseline

- `migrations/001_initial_schema.sql` is the initial MVP schema.
- It was normalized from `incoming/team_schema.sql` using `Project_Planning_Document.md` Draft 1 as the product source.
- `migrations/002_enable_all_deny_rls.sql` enables baseline all-deny RLS.
- `migrations/003_enforce_review_flow_file_session_consistency.sql` ensures PR review flow-file links stay within one review session.
- `migrations/004_harden_functions_and_index_foreign_keys.sql` pins public function search paths and adds indexes for foreign keys.
- `migrations/005_create_user_sessions.sql` adds server-side hashed session token storage.
