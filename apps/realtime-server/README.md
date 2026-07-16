# PILO Realtime Server

Owner: 진호

Primary contracts:

- Canvas realtime events: `docs/api/canvas-api.md`
- Board realtime events: `docs/api/board-api.md`
- Infra/env: `docs/infra/dev-architecture.md`, `docs/infra/secrets.md`

`apps/realtime-server` owns app-level realtime delivery. It does not own domain
source-of-truth data. App Server and PostgreSQL remain the source of truth for
auth, workspace access, Canvas shape state, and operation logs.

## Structure

```text
src/
  server.ts
  auth/
  config/
  database/
  socket/
  redis/
  board/
  canvas/
  pr-review/
```

- `server.ts`: HTTP health endpoint, raw `/ws` compatibility scaffold, and
  Socket.IO bootstrap.
- `config/`: environment parsing only.
- `auth/`: bearer session validation aligned with app-server `user_sessions`.
- `database/`: shared PostgreSQL connection helper for realtime access checks.
- `socket/`: domain-neutral Socket.IO bootstrap, auth middleware, room naming,
  and error payload helpers.
- `redis/`: Redis adapter/pub-sub integration. Redis is optional locally and
  enabled when `REDIS_URL` exists.
- `board/`: Board-specific room, access, event, and invalidation logic.
- `canvas/`: Canvas-specific room, access, event, and presence logic.
- `pr-review/`: PR Review decision event validation and delivery contracts.

## Boundaries

Common realtime code belongs in `socket/`, `redis/`, `auth/`, `database/`, or
`config/` only when another realtime domain can reuse it.

Domain behavior belongs in `src/<domain>/`. Board room naming, Board access
rules, and Board invalidation contracts stay in `src/board/` and
`src/socket/board/`. Canvas room naming, Canvas access rules, cursor presence
payloads, room-level loaded region state, and Canvas operation broadcast
contracts stay in `src/canvas/`.

Do not store cursor position or selection in PostgreSQL. Presence is realtime
state only. Canvas shape state and operation catch-up remain App Server/API/DB
responsibilities.

Classic Canvas room loaded regions are realtime room state. They indicate which
viewport bounds connected clients have already loaded, but absence from this
state is never treated as deletion.

For `tldraw_sync` Canvas, realtime-server owns the multiplayer room lifecycle.
The room key and validation contract are documented in `src/canvas/README.md`;
recoverable room snapshots are persisted to the same `canvas_sync_documents`
boundary used by the App Server fallback API.

## Runtime

Required for authenticated Canvas and Board rooms:

- `DATABASE_URL`
- `PORT`

Optional:

- `DATABASE_SSL=true` when the PostgreSQL endpoint requires SSL.
- `REDIS_URL` to enable Socket.IO Redis adapter across multiple tasks.
- `SOCKET_IO_CORS_ORIGIN` as a comma-separated frontend origin allowlist.
- `REALTIME_SCOPE` for health/debug scope reporting.
- `APP_SERVER_URL` for classic Canvas roomState checkpoint persistence through
  the existing App Server `/shapes/batch` transaction boundary.

## tldraw_sync deployment notes

- Browser clients connect to `/sync/canvas` through
  `NEXT_PUBLIC_PILO_REALTIME_SERVER_URL`.
- The load balancer must route `/sync/*` WebSocket upgrades to realtime-server.
- `canvas_sync_documents` migrations must be applied before enabling
  `tldraw_sync` Canvas creation/conversion.
- The current room implementation is in-memory per realtime-server process.
  Run one realtime-server task or configure sticky routing for `/sync/canvas`
  before using multiple tasks.
- `/health` and `/sync/health` include the current `tldraw_sync` room count,
  active session count, and pending persist count.

## Verification

```bash
npm run lint
npm run test
npm run build
npm run format:check
```
