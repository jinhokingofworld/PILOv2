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
- `migrations/006_update_workspace_and_meeting_recording_constraints.sql` updates workspace owner uniqueness and meeting recording/report constraints.
- `migrations/007_create_github_callback_states.sql` adds one-time server-side callback state storage for GitHub OAuth and GitHub App installation redirects.
- `migrations/008_create_workspace_memberships_and_invitations.sql` adds owner/member workspace membership, invitation storage, and owner backfill.
- `migrations/009_canvas_shape_hash_revision_viewport_index.sql` adds Canvas shape content hashes, revisions, generated bounds, and active viewport/order indexes.
- `migrations/010_add_review_file_risk_level.sql` adds PR review file risk level storage.
- `migrations/011_scope_github_source_uniques_by_workspace.sql` scopes GitHub source identity unique constraints to each Workspace or parent project.
- `migrations/012_create_sql_erd_sessions.sql` adds Workspace sqltoerd session storage with one active session per Workspace.
- `migrations/013_canvas_shape_operations.sql` adds Canvas realtime collaboration operation ordering, shape operation log, idempotency constraints, and presence activity timestamp.
- `migrations/014_create_drive_items_and_uploads.sql` adds Workspace shared drive metadata and presigned upload tracking.
