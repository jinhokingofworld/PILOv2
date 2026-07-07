# Realtime Canvas Module

Owner: 동현

API contract: `docs/api/canvas-api.md`

This module owns Canvas Socket.IO rooms and presence delivery.

## Responsibilities

- Validate Canvas room join payloads.
- Check workspace/canvas access before joining a room.
- Broadcast cursor and selection presence to other sockets in the room.
- Emit leave events when a socket leaves or disconnects.
- Return `canvas:joined` with current in-memory room presence.

## Non-Responsibilities

- Canvas shape persistence.
- Canvas shape operation log writes.
- `operations?afterSeq` catch-up API.
- CRDT, Yjs, or tldraw sync.
- Long-term presence storage.

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
3. `canvas` must belong to the workspace and have `board_type = 'freeform'`.

PR Review canvas surfaces should opt in explicitly later instead of receiving
Canvas presence automatically through the shared tldraw surface.
