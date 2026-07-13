import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  loadRealtimeServerConfig,
} = require("../../dist/config/realtime-config.js");
const {
  createRealtimeDatabasePoolConfig,
} = require("../../dist/database/database.js");

const config = loadRealtimeServerConfig({
  DATABASE_APPLICATION_NAME: "pilo-dev-realtime-server",
  DATABASE_POOL_CONNECTION_TIMEOUT_MS: "5000",
  DATABASE_POOL_IDLE_TIMEOUT_MS: "10000",
  DATABASE_POOL_MAX: "1",
  DATABASE_SSL: "true",
  DATABASE_URL: "postgresql://example.test/pilo",
});

assert.equal(config.databaseApplicationName, "pilo-dev-realtime-server");
assert.equal(config.databasePoolConnectionTimeoutMs, 5_000);
assert.equal(config.databasePoolIdleTimeoutMs, 10_000);
assert.equal(config.databasePoolMax, 1);

const poolConfig = createRealtimeDatabasePoolConfig({
  databaseApplicationName: config.databaseApplicationName,
  databasePoolConnectionTimeoutMs: config.databasePoolConnectionTimeoutMs,
  databasePoolIdleTimeoutMs: config.databasePoolIdleTimeoutMs,
  databasePoolMax: config.databasePoolMax,
  databaseSsl: config.databaseSsl,
  databaseUrl: config.databaseUrl,
});

assert.equal(poolConfig.application_name, "pilo-dev-realtime-server");
assert.equal(poolConfig.max, 1);
assert.equal(poolConfig.idleTimeoutMillis, 10_000);
assert.equal(poolConfig.connectionTimeoutMillis, 5_000);
assert.deepEqual(poolConfig.ssl, { rejectUnauthorized: false });

assert.throws(
  () => loadRealtimeServerConfig({ DATABASE_POOL_MAX: "0" }),
  /DATABASE_POOL_MAX must be a positive integer/,
);

console.log("Realtime database pool configuration tests passed");
