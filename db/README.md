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
- `migrations/015_add_github_project_oauth.sql` adds GitHub ProjectV2 OAuth token storage and callback state flow support.
- `migrations/016_canvas_shape_parent_relation.sql` adds Canvas shape parent relation storage and indexing for frame-scoped lazy loading.
- `migrations/017_create_agent_runs.sql` adds Workspace Agent run, step, confirmation, and diagnostic log storage.
- `migrations/018_fix_project_item_sync_positions.sql` backfills duplicate GitHub Project item positions and enforces per-field uniqueness.
- `migrations/019_normalize_canvas_page_parent_shapes.sql` restores accidentally persisted tldraw page parents to top-level Canvas shapes.
- `migrations/020_backfill_project_item_field_value_uniqueness.sql` removes duplicate ProjectV2 item field-value cache rows and ensures `(project_item_id, field_name)` uniqueness for Board write upserts.
- `migrations/021_add_user_workspace_presence.sql` adds current active Workspace presence fields to `users`.
- `migrations/022_create_board_issue_create_operations.sql` adds durable Board Issue creation idempotency, step checkpoints, retry leases, and remote-resource lookup indexes.
- `migrations/023_enable_sql_erd_multi_sessions.sql` removes the one-active-session-per-Workspace unique index and adds the active session recent-order index for SQLtoERD multi-session storage.
- `migrations/024_create_agent_run_outbox.sql` adds durable Agent planning-job delivery intents, bounded retry state, and recovery claim indexes.
- `migrations/025_create_github_project_v2_selections.sql` adds selected GitHub ProjectV2 storage per installation with RLS enabled.
- `migrations/026_replace_pilo_sticky_notes_with_tldraw_notes.sql` migrates saved custom PILO sticky notes to Tldraw built-in note shapes while preserving note text.
- `migrations/027_create_canvas_agent_runtime.sql` adds Canvas AI runtime tables, per-user draft storage, semantic shape embeddings, and pgvector support for Canvas-only actions.
- `migrations/028_add_queued_github_sync_status.sql` adds the queued GitHub sync status in a standalone transaction.
- `migrations/029_create_github_sync_jobs.sql` adds durable GitHub worker job lease state and queued sync-run indexes for asynchronous GitHub synchronization.
- `migrations/030_enable_github_sync_jobs_rls.sql` enables all-deny RLS for durable GitHub sync worker jobs.
- `migrations/031_create_pr_review_analysis_jobs.sql` adds asynchronous PR Review analysis jobs, durable SQS publish state, analysis failure fields, and duplicate-analyzing-session protection.
- `migrations/032_create_livekit_webhook_deliveries.sql` adds durable verified LiveKit participant departure webhook delivery records with all-deny RLS.
- `migrations/033_create_meeting_report_outbox.sql` adds durable MeetingReport SQS delivery intents and retry lease state with all-deny RLS.
- `migrations/034_repository_scope_github_project_v2_selections.sql` adds the `source` GitHub sync target and scopes ProjectV2 selections to repositories while preserving cache tables and all-deny RLS.
- `migrations/035_remove_owner_workspace_unique_limit.sql` removes the one-owner-Workspace-per-user unique index and restores a non-unique owner lookup index for multi-Workspace ownership.
- `migrations/036_add_workspace_icon.sql` adds an optional Workspace icon with a bounded text length for navigation and onboarding display.
- `migrations/037_add_github_project_v2_webhook_reconcile_context.sql` adds ProjectV2 webhook delivery context, processing leases, retry attempts, and a runnable-delivery index. It is recorded in Supabase migration history as `20260711230721_037_add_github_project_v2_webhook_reconcile_context`.
- `migrations/038_create_github_project_v2_polling_schedules.sql` adds repository-scoped personal ProjectV2 polling schedules, due-row leases, and active sync-run tracking with all-deny RLS. It is recorded in Supabase migration history as `20260712023811_create_github_project_v2_polling_schedules`.
- `migrations/039_add_github_sync_job_lease_generation.sql` adds a monotonic worker lease generation to durable GitHub sync jobs so stale workers cannot complete a reclaimed job. It is recorded in Supabase migration history as `20260712023819_add_github_sync_job_lease_generation`.
- `migrations/040_create_pr_review_semantic_graph_relations.sql` adds normalized PR Review file roles and validated Flow-scoped semantic relations with all-deny RLS.
- `migrations/041_add_meeting_report_progress_statuses.sql` adds user-visible MeetingReport queued, transcribing, and summarizing statuses.
- `migrations/042_set_meeting_report_queued_default.sql` sets the MeetingReport status default to queued after the new enum values are committed.
- `migrations/044_create_github_oauth_connections.sql` creates purpose-specific GitHub Integration OAuth connections with active-account uniqueness and all-deny RLS. It was already applied to dev before repository renumbering, under Supabase history entry `20260712160952_043_create_github_oauth_connections`.
- `migrations/045_invalidate_legacy_github_oauth_tokens.sql` invalidates legacy GitHub App and ProjectV2 OAuth credentials during the dev incompatible cutover. It was already applied to dev before repository renumbering, under Supabase history entry `20260712160959_044_invalidate_legacy_github_oauth_tokens`.
- `migrations/046_drop_legacy_github_oauth_columns.sql` removes the ten legacy OAuth credential columns from `users` while retaining the GitHub login identity columns. It was already applied to dev before repository renumbering, under Supabase history entry `20260712161007_045_drop_legacy_github_oauth_columns`.
- `migrations/047_add_meeting_report_evidence.sql` adds timestamped transcript segments and evidence links for MeetingReport summaries, decisions, and action item candidates. It was applied to dev under Supabase history entry `20260713030100_047_add_meeting_report_evidence`.
- `migrations/048_create_meeting_report_action_items.sql` materializes reviewable Meeting action items with audit fields, all-deny RLS, and a backfill from existing report candidates. It was applied to dev under Supabase history entry `20260713051508_048_create_meeting_report_action_items`.
- `migrations/049_add_meeting_report_action_item_actor_indexes.sql` adds indexes for the action item assignee and audit-user foreign keys. It was applied to dev under Supabase history entry `20260713051753_049_add_meeting_report_action_item_actor_indexes`.
- `migrations/050_create_shared_pr_review_rooms.sql` resets test-only PR Review sessions and introduces one shared review room and review Canvas per PR, immutable head-SHA revisions, and stable room file identities with all-deny RLS.
- `migrations/052_create_user_settings_and_account_lifecycle.sql` adds one settings row per user for PILO profile overrides and personal environment preferences, adds the account-deletion tombstone timestamp, and enables all-deny RLS for settings.
