# PILO Database

The database schema source of truth is the migration history in `db/migrations/`.

## Folders

- `incoming/`: temporary source material from team members or schema tools.
- `migrations/`: ordered SQL migrations applied to local and shared databases.

## Rules

- A migration is immutable once it is merged to `main` or applied to a shared
  database. Do not amend its SQL, filename, or number.
- Correct a released migration with the next numbered migration; never repair
  it by editing the old file.
- If an existing migration was changed before release by mistake, restore its
  canonical bytes first and add a new migration for the intended schema
  change.
- Keep generated diagrams or design exports in `incoming/`; do not apply them directly.
- Validate migrations against PostgreSQL before sharing them.

## Shared RDS migration execution

- Shared RDS migrations are applied only through the dedicated ECS migration
  runner in `infra/db-migrations/`.
- The runner records the migration number, filename, SHA-256 checksum, source
  revision, execution mode, actor, and timestamp in
  `pilo_migrations.schema_migrations`.
- The restored dev RDS schema must be baselined through migration `099` before
  applying later files; baseline mode records those files without executing
  them again.
- Runner-managed migrations after `099` must not contain their own
  `BEGIN`, `COMMIT`, `ROLLBACK`, or `psql` meta-commands. The runner owns the
  transaction and records history atomically with the schema change.
- Creating a migration file does not authorize applying it. Shared RDS apply
  still requires DB Schema owner approval.

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
- `migrations/053_create_meeting_rooms.sql` adds Workspace-scoped MeetingRoom resources, default-room backfill and new-Workspace trigger, active room name/key uniqueness, timestamp tracking, and all-deny RLS.
- `migrations/054_create_workspace_recording_consents.sql` records immutable user consent per Workspace and policy version, with duplicate prevention, lookup indexing, and all-deny RLS.
- `migrations/055_revoke_workspace_recording_consents_data_api_access.sql` revokes Data API table privileges from public API roles because this consent audit table is accessed only through the App Server's direct database connection.
- `migrations/057_add_pr_review_decision_version.sql` adds a monotonic optimistic concurrency version to each PR Review file decision state so concurrent reviewers cannot silently overwrite one another.
- `migrations/058_add_meeting_report_transcript_rag.sql` adds durable MeetingReport transcript embedding jobs and `vector(1536)` HNSW chunks for authorized RAG retrieval.
- `migrations/059_create_workspace_board_settings.sql` adds the Workspace-scoped active Board source, prevents cross-Workspace Board references with a composite foreign key, tracks updates, and enables all-deny RLS. It was applied to the Supabase dev project under history entry `20260714112332_create_workspace_board_settings`.
- `migrations/060_create_agent_grounded_answer_outbox.sql` adds server-only durable dispatch intents for the Agent grounded-answer phase; only transcript chunk identifiers, never excerpts, are retained.
- `migrations/061_create_sql_erd_operation_delivery.sql` adds the SQLtoERD snapshot/operations_v1 write protocol, ordered layout operation log, and durable realtime broadcast outbox with reclaimable publisher leases.
- `migrations/062_create_pr_review_conflict_drafts.sql` adds durable per-file shared Conflict resolution drafts with optimistic draft versions, audit actor data, timestamp tracking, and all-deny RLS.
- `migrations/063_create_sql_erd_source_snapshots_and_locks.sql` adds immutable SQLtoERD source snapshots, source-writer leases, and source snapshot operation references.
- `migrations/064_add_pr_review_conflict_draft_resolution_state.sql` stores durable Conflict hunk-selection and direct-edit state so shared draft reloads do not misclassify selection results as manual code edits.
- `migrations/065_add_activity_log_dedupe_key.sql` adds the required Workspace-scoped idempotency key for common append-only Activity Log writers.
- `migrations/066_fix_board_hydration_timestamp.sql` fixes Board hydration timestamp shapes so row timestamps can be parsed consistently.
- `migrations/067_add_canvas_engine_type.sql` adds Canvas engine type metadata for separating classic Canvas persistence from tldraw sync documents.
- `migrations/068_create_canvas_sync_documents.sql` adds `canvas_sync_documents` for tldraw sync Canvas document snapshots.
- `migrations/069_create_sql_erd_session_creation_audit.sql` records every SQLtoERD session INSERT with an AFTER INSERT trigger so operations_v1 cutover monitoring also catches direct or default-protocol creation paths.
- `migrations/070_create_activity_log_foundation_constraints.sql` enforces the Activity Log v1 metadata envelope, preserves pre-envelope metadata under `data.legacyMetadata`, and blocks ordinary row mutation while allowing account anonymization and tenant purge.
- `migrations/071_create_meeting_report_activity_evidence.sql` stores bounded safe Activity Log projections and their MeetingReport-output references, with all-deny RLS and no copied raw metadata.
- `migrations/072_convert_meeting_participants_to_session_history.sql` preserves each Meeting participation interval, keeps only one active session per user and LiveKit identity, and excludes unreconstructable legacy intervals from new Activity snapshots.
- `migrations/073_create_workspace_documents.sql` adds Workspace-native Drive documents, edit sessions, versioned Yjs updates and snapshots, document Activity Log actions, and all-deny RLS.
- `migrations/074_create_meeting_agent_workflow.sql` adds Meeting action-item delivery and decision evidence relations, append-only Agent run messages, versioned planner-turn rearming on the existing run outbox, and the `waiting_user_input` run status. It was applied to the Supabase dev project under history entry `20260716060356_074_create_meeting_agent_workflow`.
- `migrations/075_preserve_meeting_action_item_delivery_targets.sql` lets Calendar and Board delete delivered targets while retaining the immutable target ID in Meeting action-item delivery history. It follows the early shared-dev application of migration 074.
- `migrations/078_add_agent_contextual_execution.sql` adds immutable Agent request context, choice confirmation selection state, and the SQLtoERD Agent session-creation idempotency ledger.
- `migrations/079_allow_board_issue_operation_parent_cleanup.sql` preserves succeeded Board Issue creation operations when their cached PILO Issue is deleted by allowing `pilo_issue_id` to be cleared by its `ON DELETE SET NULL` foreign key.
- `migrations/080_add_pr_review_activity_log_actions.sql` adds the PR Review conflict-resolution-applied and pull-request-merged Activity Log actions.
- `migrations/081_add_meeting_report_activity_evidence_rag.sql` adds durable Activity evidence embedding jobs and safe `vector(1536)` chunks for MeetingReport RAG. It indexes only the MeetingReport snapshot action, summary, and timestamp; raw Activity Log metadata is never copied.
- `migrations/082_create_workspace_chat.sql` adds Workspace Chat messages, monotonic read state, member mentions, author-delete tombstones, lookup indexes, and all-deny RLS. It was applied to the Supabase dev project under history entry `20260716171029_082_create_workspace_chat`.
- `migrations/083_preserve_github_project_v2_reconnect_identity.sql` makes the ProjectV2 installation link nullable with `ON DELETE SET NULL`, preserving repository, ProjectV2, repository link, and Board cache identities across GitHub App installation deletion and reconnect. It was applied to the Supabase dev project under history entry `20260716173438_083_preserve_github_project_v2_reconnect_identity`.
- `migrations/085_add_sql_erd_activity_log_actions.sql` adds SQLtoERD session, schema, rename, delete, and meaningful note-content Activity Log actions.
- `migrations/086_create_workspace_membership_revocation_outbox.sql` adds durable, reclaimable Workspace membership revocation delivery intents so Redis publish failures are retried without rolling back the committed membership deletion.
- `migrations/088_add_github_sync_run_trigger_source.sql` classifies new GitHub sync runs as `manual` or `automatic`, preserves existing rows as `legacy`, and adds a recent-history lookup index by Workspace and trigger source. It was applied to the Supabase dev project under history entry `20260717065721_088_add_github_sync_run_trigger_source`.
- `migrations/090_add_github_oauth_token_refresh.sql` idempotently adds an encrypted refresh token and access/refresh expiry timestamps to `github_oauth_connections`. It was applied to Supabase project `PILO-Project` under history entry `20260717105402_090_add_github_oauth_token_refresh`, and `IF NOT EXISTS` keeps already-applied environments safe.
- `migrations/091_create_google_calendar_sync.sql` creates Google Calendar OAuth connection, event mapping, and synchronization outbox storage.
- `migrations/092_fix_google_calendar_sync_delivery.sql` stores the destination Google Calendar per synchronized event after migration 091 creates the synchronization tables.
- `migrations/094_create_meeting_recording_activity_links.sql` links safe Canvas Activity Logs to the recording selected at Realtime receive time, preserves `captured_at`/`receive_seq`, enforces capture idempotency, and keeps the server-only RLS boundary.
- `migrations/099_create_agent_candidate_selections.sql` adds short-lived, one-time server-owned Agent clarification candidates bound to their originating tool step. Browser clients receive only the opaque candidate ID; resource references remain behind the App Server and all-deny RLS.
- `migrations/102_generalize_agent_candidate_generations.sql` treats each clarification tool step as a domain-neutral candidate generation, assigns stable 1-based ordinals, and lets domain adapters revalidate Meeting and SQLtoERD references before one-time consumption.
- `migrations/100_fix_canvas_agent_pgcrypto_digest_schema.sql` aligns the Canvas Agent embedding trigger with RDS pgcrypto installed in `public`, restoring Canvas checkpoint writes without moving the extension or changing the API schema.
- `migrations/101_add_agent_outbox_planning_started_at.sql` records the server-owned start time of each Agent planning turn so publisher claim/retry updates cannot extend its terminal deadline.
- `migrations/105_remove_unused_canvas_sync_storage.sql` removes unused tldraw sync document storage and engine source/version metadata after verifying that no sync Canvas data remains, while retaining the temporary Classic-only engine guard.

## Operational Data Repairs

- Issue #1252 uses `apps/app-server/scripts/board/project-v2-board-data-repair.mjs` to repair eligible failed Meeting delivery retries and remove only explicitly scoped, reference-free legacy Boards. It changes data through a reviewed operator transaction and does not add or alter a migration or database schema. Dry-run is the default; operational apply requires exact expected counts, a rollback manifest, and DB owner approval. On 2026-07-17, the approved Supabase dev apply updated 2 failed Meeting deliveries and 2 retryable Board operations, deleted reference-free Boards `25`, `26`, `33`, `34`, `37`, `40`, and `299`, and retained Boards `50`, `3673`, and `3674`. Post-apply FK/logical-reference checks and the repeated no-op check passed.
