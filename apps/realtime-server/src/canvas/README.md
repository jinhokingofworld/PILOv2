# Realtime Canvas Module

Owner: 동현

API contract: `docs/api/canvas-api.md`

This module owns Canvas Socket.IO rooms and presence delivery.

## Responsibilities

- Validate Canvas room join payloads.
- Check workspace/canvas access before joining a room.
- Return whether the joined Canvas room is read-only.
- Broadcast cursor, selection, and edit-intent presence to other sockets in the
  room.
- Emit leave events when a socket leaves or disconnects.
- Return `canvas:joined` with current in-memory room presence.
- Hydrate an empty classic Canvas room cache from the App Server viewport shape
  API when `canvas:join.initialViewportBounds` is provided. This is a
  best-effort optimization; join must still succeed when the hydrate request
  fails so the frontend can fall back to its normal viewport lazy loading.
- Flush dirty classic Canvas room checkpoints on explicit leave, unexpected
  socket disconnect, and graceful server shutdown.
- Validate tldraw sync-room access and create canvas-scoped sync rooms lazily.

## Non-Responsibilities

- Canvas shape persistence.
- Canvas shape operation log writes.
- `operations?afterSeq` catch-up API.
- CRDT or Yjs.
- Long-term presence storage.
- Persisting `editingShapeId` or `editingMode`; edit intent is realtime-only.
- Treating absence from the room cache as deletion. Deletion requires an
  explicit delete patch/tombstone.
- Evicting dirty roomState shapes before they are checkpointed. Cache eviction
  may remove clean hydrated shapes, but pending local changes must stay until
  App Server confirms the checkpoint.

Note: `@tldraw/sync` room state is owned by realtime-server. The room persists
its recoverable snapshot to `canvas_sync_documents`, while local UI Preview can
still use App Server snapshot persistence fallback when no realtime server/token
is available.

## Event Boundary

Client events:

- `canvas:join`
- `canvas:leave`
- `canvas:presence:update`

Server events:

- `canvas:joined`
- `canvas:presence:update`
- `canvas:presence:leave`
- `canvas:error`

`canvas:operation` and `canvas:sync:required` are reserved by the Canvas API
contract for the operation-log phase. They should be emitted only after App
Server mutation and catch-up paths write/read `canvas_shape_operations`.

## Access Boundary

Realtime Canvas access follows App Server semantics:

1. Bearer token is validated against `user_sessions`.
2. `workspace_members` must contain the authenticated user.
3. `canvas` must belong to the workspace and be either `board_type = 'freeform'`
   or a `board_type = 'review'` Canvas connected to a PR Review room.
4. Active Review Canvas rooms are read-write. Completed Review Canvas rooms are
   read-only: presence is allowed, while shape lock and preview events are
   rejected.

PR Review canvas surfaces opt in explicitly instead of receiving Canvas
presence automatically through the shared tldraw surface.

## tldraw_sync Room Contract

`@tldraw/sync` multiplayer belongs to this Canvas module rather than App Server.

Room identity:

```text
workspace:{workspaceId}:canvas:{canvasId}:tldraw-sync
```

Join input:

```ts
type CanvasTldrawSyncJoinInput = {
  workspaceId: string;
  canvasId: string;
};
```

Validation:

1. Validate bearer session with the same socket auth path used by Canvas
   presence.
2. Verify `workspace_members` contains the authenticated user.
3. Verify `canvas.workspace_id = workspaceId`.
4. Verify `canvas.id = canvasId`.
5. Verify `canvas.board_type = 'freeform'`.
6. Verify `canvas.engine_type = 'tldraw_sync'`.
7. Reject client-provided room keys. The server builds the room key only after
   validation succeeds.

Lifecycle:

- A sync room is created lazily when the first authorized socket joins.
- If the room already exists, the socket joins the existing room.
- When the last socket leaves, in-memory room state may be released.
- Room release must not delete `canvas_sync_documents`.

Persistence:

- The sync room may hydrate from `canvas_sync_documents.snapshot`.
- Snapshot saves use `canvas_sync_documents` directly from realtime-server with
  the same workspace/canvas/provider boundary as the App Server sync-document
  fallback API.
- Do not write tldraw sync document state into `canvas_freeform_shapes` or
  `canvas_shape_operations`.

Scale-out:

- With one realtime-server task, in-memory rooms are enough for local
  development.
- With multiple realtime-server tasks, Socket.IO Redis adapter alone does not
  make a tldraw sync document authoritative. The sync engine also needs shared
  persistence or a provider-level coordination strategy.
