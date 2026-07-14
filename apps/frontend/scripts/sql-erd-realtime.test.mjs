import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const types = await readFile(
  new URL(
    "../src/features/sql-erd/realtime/sql-erd-realtime-types.ts",
    import.meta.url,
  ),
  "utf8",
);
const client = await readFile(
  new URL(
    "../src/features/sql-erd/realtime/sql-erd-realtime-client.ts",
    import.meta.url,
  ),
  "utf8",
);
const presenceHook = await readFile(
  new URL(
    "../src/features/sql-erd/realtime/use-sql-erd-presence.ts",
    import.meta.url,
  ),
  "utf8",
);
const bridge = await readFile(
  new URL(
    "../src/features/sql-erd/realtime/sql-erd-realtime-bridge.tsx",
    import.meta.url,
  ),
  "utf8",
);
const canvas = await readFile(
  new URL("../src/features/sql-erd/components/sql-erd-canvas.tsx", import.meta.url),
  "utf8",
);

assert.match(types, /"sql-erd:join"/);
assert.match(types, /"sql-erd:presence:update"/);
assert.match(types, /selectedShapeIds: string\[\]/);
assert.match(client, /socket\.io-client/);
assert.match(presenceHook, /"sql-erd:joined"/);
assert.match(presenceHook, /"sql-erd:presence:leave"/);
assert.match(presenceHook, /socket\.emit\("sql-erd:presence:update"/);
assert.match(presenceHook, /localPresenceRef\.current/);
assert.match(presenceHook, /PRESENCE_HEARTBEAT_MS = 10_000/);
assert.match(presenceHook, /PRESENCE_UPDATE_MIN_INTERVAL_MS = 80/);
assert.match(bridge, /useEditor/);
assert.match(bridge, /getSelectedShapeIds/);
assert.match(bridge, /pointer-events-none/);
assert.match(canvas, /useSqlErdPresence/);
assert.match(canvas, /SqlErdRealtimeBridge/);

console.log("SQLtoERD realtime frontend tests passed");
