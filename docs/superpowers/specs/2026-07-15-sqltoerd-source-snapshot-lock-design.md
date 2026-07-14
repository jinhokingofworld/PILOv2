# SQLtoERD Source Snapshot and Source Lock Design

Related issue: #1046

## Goal

Add a durable, ordered source-publish path for SQLtoERD without placing full
source/model/layout snapshots in the operation log, Redis payload, or Socket.IO
event. A source writer holds a lease while table and annotation layout
operations remain concurrently writable.

## Scope

This change includes the App Server, SQLtoERD database schema, SQLtoERD
realtime relay contract, and the canonical SQLtoERD API document.

It does not include the frontend operation runtime, source lock UI,
`operations_v1` activation, or multi-browser E2E. Those consumers will use the
contracts defined here in later work.

## Considered storage approaches

1. Store `sourceText`, `modelJson`, and `layoutJson` in every operation payload.
   Rejected: each field can be 1 MiB, while the current operation payload limit
   is 1 MiB; catch-up and realtime delivery would become unbounded.
2. Store an immutable source snapshot row and make the ordered operation refer
   to it by an FK. Selected: operation/outbox/realtime payloads remain small and
   all clients replay the exact server-produced rebase result.
3. Put snapshots in object storage. Rejected for this phase: it adds object
   lifecycle, authorization, and consistency concerns without addressing the
   currently bounded 3 MiB snapshot size.

## Immutable source snapshot model

Create `sql_erd_session_source_snapshots` with immutable rows containing:

- `id`, `workspace_id`, `session_id`, `created_by`, and `created_at`
- `source_format`, `dialect`, and `source_text`
- parsed `model_json`
- the server-rebased `layout_json`
- `base_revision` and `result_revision`
- table and relation counts derived from `model_json`

Each field has the existing SQLtoERD component limits:

- `sourceText`: UTF-8 bytes at most 1 MiB
- serialized `modelJson`: UTF-8 bytes at most 1 MiB
- serialized rebased `layoutJson`: UTF-8 bytes at most 1 MiB
- all three fields plus the snapshot envelope: serialized UTF-8 bytes at most
  3 MiB

Snapshot rows are append-only. External clients receive them only through a
workspace/session-authorized read API; no update or delete API exists. RLS has
no direct client policy, and a database trigger rejects every snapshot `UPDATE`
and direct `DELETE`. Snapshot rows remain for as long as the operation log that
refers to them remains; this phase introduces no compaction or retention
deletion job. A future compaction flow requires a separate privileged deletion
procedure.

## Operation reference model

Extend `sql_erd_session_operations` with nullable `source_snapshot_id`.

- Add `UNIQUE (workspace_id, session_id, id)` to the snapshot table.
- Add a composite FK from
  `(workspace_id, session_id, source_snapshot_id)` to the matching snapshot
  row with `ON DELETE RESTRICT`.
- Extend `operation_type` to `layout_patch | source_snapshot`.
- Add a check constraint:
  - `layout_patch` requires `source_snapshot_id IS NULL`.
  - `source_snapshot` requires `source_snapshot_id IS NOT NULL`.

The source snapshot ID is canonical in the dedicated column, not copied into
the JSON payload. A `source_snapshot` operation has only minimal metadata in
its payload. Its API and Socket.IO representation exposes `sourceSnapshotId`
as a first-class field. The operation payload limit remains 1 MiB.

The migration must include a test or migration-safe verification that the
restrict FK does not break the existing session/workspace cascade path.

## Write-protocol boundary and idempotency

This contract does not activate `operations_v1`. Source-lock acquire, renew,
release, source publish, and snapshot read APIs are available only to an
`operations_v1` session. Until activation, legacy snapshot `PATCH` remains the
source writer and does not claim source-lock semantics. After activation, every
legacy durable-state writer that can change canonical session state is rejected
so a source lease cannot be bypassed through a legacy route.

The source-publish `clientOperationId` is unique per
`(sessionId, actorUserId, clientOperationId)`. The server stores a SHA-256
request fingerprint over the normalized source-publish input. A retry with the
same key and fingerprint returns the original operation, snapshot ID, revision,
and rebase summary without creating another snapshot or advancing `opSeq`. The
same key with a different fingerprint returns `409 CONFLICT`.

## Source lock lease

Create one SQLtoERD source-lock row per session with `workspace_id`,
`session_id`, `lease_id`, `actor_user_id`, `source_base_revision`, and
`expires_at`.

- Acquire locks the session row before it inspects or inserts the lease row. It
  accepts a stable client-generated `leaseId`, making a lost acquire response
  retriable. It grants a 30-second lease when no active lease exists and
  records the current session revision as `source_base_revision`.
- Renew is allowed only for the lease owner before expiry and extends the lease
  by 30 seconds. The frontend will renew every 10 seconds in a later change.
- Publish and renew require the matching, unexpired owner/lease pair and
  otherwise return `409`. Release is idempotent only for a missing or expired
  matching lease; a mismatched active lease returns a generic conflict without
  revealing the holder.
- A competing active acquire returns `409 SQL_ERD_SOURCE_LOCKED`.
- Layout operations do not require this lease and remain writable.

No presence state is persisted in this table. It is solely the durable source
writer lease.

## Source publish and rebase transaction

`POST /workspaces/{workspaceId}/sql-erd-sessions/{sessionId}/source-snapshots`
uses a route body limit of 4 MiB. Its request includes a lease ID,
client-operation id, source base revision, source format/dialect, source text,
and parsed model JSON. It does not accept client `layoutJson`.

The 4 MiB HTTP body limit permits the two 1 MiB inputs plus JSON envelope.
The stricter 3 MiB total limit applies to the server-created immutable snapshot
that additionally contains the rebased layout.

In one DB transaction, the server:

1. Locks the session row and verifies workspace access and the active source
   lease.
2. Validates that the request source base revision equals the lease's current
   `source_base_revision`; layout-only revisions after that base are allowed.
3. Rebases the latest persisted layout onto the new model.
4. Validates the resulting layout against the new model.
5. Inserts the immutable snapshot row.
6. Updates the session source/model/layout/counts/revision and the lock's
   source base revision to the snapshot `result_revision`.
7. Inserts the ordered `source_snapshot` operation and transactional outbox
   row, then commits.

The operation response contains the saved operation, revision, latest sequence,
snapshot ID, and a deterministic rebase summary. Redis and Socket.IO broadcast
only the saved operation after commit.

## Deterministic rebase rules

The current DDL parser creates stable IDs from qualified table name and column
name (`table.{schema.}name` and `column.{schema.}table.column`). Source rebase
uses those IDs and never guesses renamed entities.

- Keep an existing table layout only when its `tableId` exists in the new model.
- Add missing layouts for new tables in ascending `tableId` order. Use a
  fallback size of 320×180 and a 72px gap. With no retained table layout, place
  the first at `(80, 80)` and use the three-column grid `(80 + (index % 3) *
  360, 80 + floor(index / 3) * 280)`. With retained layouts, start each new
  table at `rightmost retained x + retained width + 144`, at the retained
  topmost y (minimum 80), then scan downward in 252px increments for the first
  non-overlapping position. Each collision check includes retained layouts and
  every layout generated earlier in the same rebase. The rightmost boundary is
  `max(x + (width ?? 320))`. Existing positions are never moved.
- Keep notes, frames, texts, strokes, and viewport because they have no model
  endpoint dependency.
- Remove annotation links whose table or column endpoint no longer exists.
- Validate the complete rebase result with the existing SQLtoERD layout
  validation before it can be stored.
- Return removed layout and annotation IDs in `rebaseSummary`; the source
  publish succeeds with the deterministic removal rather than persisting an
  invalid reference.

A layout operation committed before source publish is part of the rebase input.
A layout operation committed after source publish validates against the new
model. A syntactically valid operation targeting an entity removed by the new
model fails with `409 SQL_ERD_OPERATION_TARGET_INVALID` rather than silently
dropping its command.

## Snapshot read and replay

Provide a session-scoped batch read API:

```text
GET /workspaces/{workspaceId}/sql-erd-sessions/{sessionId}/source-snapshots?ids={id1},{id2}
```

- Normalize duplicate IDs, require one to three unique UUIDs, and reject query
  strings over 2,048 characters.
- Every requested ID must exist in the stated workspace/session. Any missing or
  cross-session ID returns `404`; the API never silently omits an item.
- The response preserves normalized request order and may contain at most three
  snapshots with a combined serialized response size of at most 10 MiB.

The source-publish request body contains only `sourceText`, `modelJson`, and
the small lease/operation envelope. The App Server does not parse SQL in this
phase; the client must send `modelJson` from the same parse result as
`sourceText`. The server validates schema, component sizes, the 3 MiB persisted
snapshot total, and the rebased layout, but cannot prove semantic equivalence
between source text and model JSON.

When a client sees `source_snapshot` at sequence `N`, it buffers operations
with a higher sequence, batch-fetches the required snapshot, applies the exact
snapshot content, advances to `N`, then applies buffered operations in sequence
order. It deduplicates operation IDs and sequences as defined by the existing
operation protocol.

## Required verification

- Snapshot/source-operation constraints, size limits, and cross-session FK
  rejection.
- Lock acquire competition, renew, expiry, release, and publish ownership.
- Source publish versus layout operation serialization in both commit orders.
- Rebase preservation, deterministic removal, and invalid post-snapshot layout
  operation conflict.
- Snapshot batch duplicate normalization, missing-ID error, count/query-size
  limit, and 10 MiB response limit.
- Outbox/realtime payload includes source snapshot ID only, never full source,
  model, or layout content.
