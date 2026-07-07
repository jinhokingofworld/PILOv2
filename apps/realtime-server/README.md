# PILO Realtime Server

Owner: 진호

Primary contracts:

- Canvas realtime events: `docs/api/canvas-api.md`
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
  canvas/
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
- `canvas/`: Canvas-specific room, access, event, and presence logic.

## Boundaries

Common realtime code belongs in `socket/`, `redis/`, `auth/`, `database/`, or
`config/` only when another realtime domain can reuse it.

Domain behavior belongs in `src/<domain>/`. Canvas room naming, Canvas access
rules, cursor presence payloads, and Canvas operation broadcast contracts stay in
`src/canvas/`.

Do not store cursor position or selection in PostgreSQL. Presence is realtime
state only. Canvas shape state and operation catch-up remain App Server/API/DB
responsibilities.

## Runtime

Required for authenticated Canvas rooms:

- `DATABASE_URL`
- `PORT`

Optional:

- `DATABASE_SSL=true` when the PostgreSQL endpoint requires SSL.
- `REDIS_URL` to enable Socket.IO Redis adapter across multiple tasks.
- `SOCKET_IO_CORS_ORIGIN` as a comma-separated frontend origin allowlist.
- `REALTIME_SCOPE` for health/debug scope reporting.

## Verification

```bash
npm run lint
npm run test
npm run build
npm run format:check
```
