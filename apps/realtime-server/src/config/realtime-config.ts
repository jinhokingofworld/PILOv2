export type RealtimeServerConfig = {
  corsOrigin: string | string[];
  databaseApplicationName: string;
  databasePoolConnectionTimeoutMs: number;
  databasePoolIdleTimeoutMs: number;
  databasePoolMax: number;
  databaseSsl: boolean;
  databaseUrl: string;
  port: number;
  redisUrl: string | null;
  scope: string;
};

const DEFAULT_DATABASE_URL = "postgresql://pilo:pilo@localhost:5432/pilo";
const DEFAULT_DATABASE_POOL_MAX = 1;
const DEFAULT_DATABASE_POOL_IDLE_TIMEOUT_MS = 10_000;
const DEFAULT_DATABASE_POOL_CONNECTION_TIMEOUT_MS = 5_000;
const DEFAULT_DATABASE_APPLICATION_NAME = "pilo-realtime-server";

function parseCorsOrigin(value: string | undefined) {
  if (!value) return "*";

  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) return "*";
  if (origins.length === 1) return origins[0] ?? "*";

  return origins;
}

export function loadRealtimeServerConfig(
  env: NodeJS.ProcessEnv = process.env,
): RealtimeServerConfig {
  return {
    corsOrigin: parseCorsOrigin(env.SOCKET_IO_CORS_ORIGIN),
    databaseApplicationName:
      env.DATABASE_APPLICATION_NAME?.trim() || DEFAULT_DATABASE_APPLICATION_NAME,
    databasePoolConnectionTimeoutMs: parsePositiveInteger(
      env.DATABASE_POOL_CONNECTION_TIMEOUT_MS,
      "DATABASE_POOL_CONNECTION_TIMEOUT_MS",
      DEFAULT_DATABASE_POOL_CONNECTION_TIMEOUT_MS,
    ),
    databasePoolIdleTimeoutMs: parsePositiveInteger(
      env.DATABASE_POOL_IDLE_TIMEOUT_MS,
      "DATABASE_POOL_IDLE_TIMEOUT_MS",
      DEFAULT_DATABASE_POOL_IDLE_TIMEOUT_MS,
    ),
    databasePoolMax: parsePositiveInteger(
      env.DATABASE_POOL_MAX,
      "DATABASE_POOL_MAX",
      DEFAULT_DATABASE_POOL_MAX,
    ),
    databaseSsl: env.DATABASE_SSL === "true",
    databaseUrl: env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    port: Number.parseInt(env.PORT ?? "3001", 10),
    redisUrl: env.REDIS_URL ?? null,
    scope: env.REALTIME_SCOPE ?? "notifications_status_only",
  };
}

function parsePositiveInteger(
  value: string | undefined,
  variableName: string,
  fallback: number,
): number {
  if (value === undefined || value.trim() === "") return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${variableName} must be a positive integer`);
  }

  return parsed;
}
