import { Pool, type PoolConfig, type QueryResult, type QueryResultRow } from "pg";

export type RealtimeDatabase = {
  close: () => Promise<void>;
  execute: <T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ) => Promise<QueryResult<T>>;
  query: <T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ) => Promise<T[]>;
  queryOne: <T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ) => Promise<T | null>;
};

export function createRealtimeDatabase({
  databaseApplicationName,
  databasePoolConnectionTimeoutMs,
  databasePoolIdleTimeoutMs,
  databasePoolMax,
  databaseSsl,
  databaseUrl,
}: {
  databaseApplicationName: string;
  databasePoolConnectionTimeoutMs: number;
  databasePoolIdleTimeoutMs: number;
  databasePoolMax: number;
  databaseSsl: boolean;
  databaseUrl: string;
}): RealtimeDatabase {
  const config = createRealtimeDatabasePoolConfig({
    databaseApplicationName,
    databasePoolConnectionTimeoutMs,
    databasePoolIdleTimeoutMs,
    databasePoolMax,
    databaseSsl,
    databaseUrl,
  });

  const pool = new Pool(config);

  return {
    async close() {
      await pool.end();
    },
    async execute<T extends QueryResultRow = QueryResultRow>(
      text: string,
      values: readonly unknown[] = [],
    ) {
      return pool.query<T>(text, [...values]);
    },
    async query<T extends QueryResultRow = QueryResultRow>(
      text: string,
      values: readonly unknown[] = [],
    ) {
      const result = await this.execute<T>(text, values);
      return result.rows;
    },
    async queryOne<T extends QueryResultRow = QueryResultRow>(
      text: string,
      values: readonly unknown[] = [],
    ) {
      const rows = await this.query<T>(text, values);
      return rows[0] ?? null;
    },
  };
}

export function createRealtimeDatabasePoolConfig({
  databaseApplicationName,
  databasePoolConnectionTimeoutMs,
  databasePoolIdleTimeoutMs,
  databasePoolMax,
  databaseSsl,
  databaseUrl,
}: {
  databaseApplicationName: string;
  databasePoolConnectionTimeoutMs: number;
  databasePoolIdleTimeoutMs: number;
  databasePoolMax: number;
  databaseSsl: boolean;
  databaseUrl: string;
}): PoolConfig {
  const config: PoolConfig = {
    application_name: databaseApplicationName,
    connectionString: databaseUrl,
    connectionTimeoutMillis: databasePoolConnectionTimeoutMs,
    idleTimeoutMillis: databasePoolIdleTimeoutMs,
    max: databasePoolMax,
  };

  if (databaseSsl) {
    config.ssl = {
      rejectUnauthorized: false,
    };
  }

  return config;
}
