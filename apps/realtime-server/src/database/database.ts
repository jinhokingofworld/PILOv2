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
  databaseSsl,
  databaseUrl,
}: {
  databaseSsl: boolean;
  databaseUrl: string;
}): RealtimeDatabase {
  const config: PoolConfig = {
    connectionString: databaseUrl,
  };

  if (databaseSsl) {
    config.ssl = {
      rejectUnauthorized: false,
    };
  }

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
