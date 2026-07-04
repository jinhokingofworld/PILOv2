import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool, PoolConfig, QueryResult, QueryResultRow } from "pg";

const DEFAULT_DATABASE_URL = "postgresql://pilo:pilo@localhost:5432/pilo";

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    const config: PoolConfig = {
      connectionString: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL
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

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
