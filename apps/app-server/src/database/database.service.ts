import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool, PoolClient, PoolConfig, QueryResult, QueryResultRow } from "pg";

const DEFAULT_DATABASE_URL = "postgresql://pilo:pilo@localhost:5432/pilo";
const LOCAL_APP_ENVS = new Set(["local", "test", "development"]);

export interface DatabaseTransaction {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<T[]>;
  queryOne<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<T | null>;
  execute<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<T>>;
}

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    const config: PoolConfig = {
      connectionString: resolveDatabaseUrl()
    };

    if (process.env.DATABASE_SSL === "true") {
      config.ssl = {
        rejectUnauthorized: false
      };
    }

    this.pool = new Pool(config);
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<T[]> {
    const result = await this.execute<T>(text, values);
    return result.rows;
  }

  async queryOne<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<T | null> {
    const rows = await this.query<T>(text, values);
    return rows[0] ?? null;
  }

  async execute<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, [...values]);
  }

  async transaction<T>(
    callback: (transaction: DatabaseTransaction) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const transaction = this.createTransaction(client);
      const result = await callback(transaction);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  private createTransaction(client: PoolClient): DatabaseTransaction {
    return {
      async query<T extends QueryResultRow = QueryResultRow>(
        text: string,
        values: readonly unknown[] = []
      ): Promise<T[]> {
        const result = await this.execute<T>(text, values);
        return result.rows;
      },
      async queryOne<T extends QueryResultRow = QueryResultRow>(
        text: string,
        values: readonly unknown[] = []
      ): Promise<T | null> {
        const rows = await this.query<T>(text, values);
        return rows[0] ?? null;
      },
      execute<T extends QueryResultRow = QueryResultRow>(
        text: string,
        values: readonly unknown[] = []
      ): Promise<QueryResult<T>> {
        return client.query<T>(text, [...values]);
      }
    };
  }
}

export function resolveDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env
): string {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (databaseUrl) {
    return databaseUrl;
  }

  if (shouldRequireDatabaseUrl(env)) {
    throw new Error(
      "DATABASE_URL is required outside local app-server environments"
    );
  }

  return DEFAULT_DATABASE_URL;
}

export function shouldRequireDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const appEnv = env.APP_ENV?.trim().toLowerCase();
  if (appEnv) {
    return !LOCAL_APP_ENVS.has(appEnv);
  }

  return env.NODE_ENV?.trim().toLowerCase() === "production";
}
