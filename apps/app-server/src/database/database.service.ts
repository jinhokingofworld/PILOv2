import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool, PoolClient, PoolConfig, QueryResult, QueryResultRow } from "pg";

const DEFAULT_DATABASE_URL = "postgresql://pilo:pilo@localhost:5432/pilo";
const LOCAL_APP_ENVS = new Set(["local", "test", "development"]);
const DEFAULT_DATABASE_POOL_MAX = 2;
const DEFAULT_DATABASE_POOL_IDLE_TIMEOUT_MS = 10_000;
const DEFAULT_DATABASE_POOL_CONNECTION_TIMEOUT_MS = 5_000;
const DEFAULT_DATABASE_APPLICATION_NAME = "pilo-app-server";

export interface DatabasePoolSettings {
  application_name: string;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
  max: number;
}

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
      connectionString: resolveDatabaseUrl(),
      ...resolveDatabasePoolSettings()
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

  async withAdvisoryLock<T>(
    lockKey: bigint,
    callback: (connection: DatabaseTransaction) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();
    const connection = this.createTransaction(client);
    let lockAcquired = false;
    let operationError: unknown;

    try {
      await connection.execute("SELECT pg_advisory_lock($1::bigint)", [lockKey]);
      lockAcquired = true;
      return await callback(connection);
    } catch (error) {
      operationError = error;
      throw error;
    } finally {
      let unlockError: Error | null = null;

      if (lockAcquired) {
        try {
          await connection.execute("SELECT pg_advisory_unlock($1::bigint)", [lockKey]);
        } catch (error) {
          unlockError = error instanceof Error ? error : new Error(String(error));
        }
      }

      client.release(unlockError ?? undefined);

      if (unlockError && operationError === undefined) {
        throw unlockError;
      }
    }
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

export function resolveDatabasePoolSettings(
  env: NodeJS.ProcessEnv = process.env
): DatabasePoolSettings {
  return {
    application_name: resolveApplicationName(
      env.DATABASE_APPLICATION_NAME,
      DEFAULT_DATABASE_APPLICATION_NAME
    ),
    connectionTimeoutMillis: resolvePositiveInteger(
      env.DATABASE_POOL_CONNECTION_TIMEOUT_MS,
      "DATABASE_POOL_CONNECTION_TIMEOUT_MS",
      DEFAULT_DATABASE_POOL_CONNECTION_TIMEOUT_MS
    ),
    idleTimeoutMillis: resolvePositiveInteger(
      env.DATABASE_POOL_IDLE_TIMEOUT_MS,
      "DATABASE_POOL_IDLE_TIMEOUT_MS",
      DEFAULT_DATABASE_POOL_IDLE_TIMEOUT_MS
    ),
    max: resolvePositiveInteger(
      env.DATABASE_POOL_MAX,
      "DATABASE_POOL_MAX",
      DEFAULT_DATABASE_POOL_MAX
    )
  };
}

function resolveApplicationName(value: string | undefined, fallback: string): string {
  return value?.trim() || fallback;
}

function resolvePositiveInteger(
  value: string | undefined,
  variableName: string,
  fallback: number
): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${variableName} must be a positive integer`);
  }

  return parsed;
}
