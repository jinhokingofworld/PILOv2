export type RealtimeServerConfig = {
  corsOrigin: string | string[];
  databaseSsl: boolean;
  databaseUrl: string;
  port: number;
  redisUrl: string | null;
  scope: string;
};

const DEFAULT_DATABASE_URL = "postgresql://pilo:pilo@localhost:5432/pilo";

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
    databaseSsl: env.DATABASE_SSL === "true",
    databaseUrl: env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    port: Number.parseInt(env.PORT ?? "3001", 10),
    redisUrl: env.REDIS_URL ?? null,
    scope: env.REALTIME_SCOPE ?? "notifications_status_only",
  };
}
