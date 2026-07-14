import { randomUUID } from "node:crypto";
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";
import { DatabaseService } from "../../database/database.service";

export const SQL_ERD_OPERATION_REDIS_CHANNEL = "sql-erd:operations";
const CLAIM_TIMEOUT_SECONDS = 60;
const SWEEP_INTERVAL_MS = 1_000;
const BATCH_SIZE = 50;
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

export function getSqlErdOperationRetryDelayMs(attemptCount: number): number {
  const index = Math.max(0, Math.min(attemptCount - 1, RETRY_DELAYS_MS.length - 1));
  return RETRY_DELAYS_MS[index];
}

interface OutboxClaim {
  claim_token: string;
  attempt_count: number | string;
  id: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class SqlErdOperationPublisherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SqlErdOperationPublisherService.name);
  private interval: ReturnType<typeof setInterval> | null = null;
  private redisClient: RedisClientType | null = null;
  private redisUrl: string | null = null;

  constructor(private readonly database: DatabaseService) {}

  onModuleInit(): void {
    this.interval = setInterval(() => void this.publishDue().catch((error: unknown) => {
      this.logger.error("SQLtoERD operation outbox sweep failed", error);
    }), SWEEP_INTERVAL_MS);
    void this.publishDue().catch((error: unknown) => {
      this.logger.error("Initial SQLtoERD operation outbox sweep failed", error);
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    await this.redisClient?.quit();
    this.redisClient = null;
    this.redisUrl = null;
  }

  async publishDue(): Promise<void> {
    const rows = await this.database.query<{ id: string }>(
      `SELECT id FROM sql_erd_session_operation_outbox
       WHERE (status = 'pending' AND next_attempt_at <= now())
          OR (status = 'publishing' AND claimed_at <= now() - ($1 * INTERVAL '1 second'))
       ORDER BY next_attempt_at ASC LIMIT $2`,
      [CLAIM_TIMEOUT_SECONDS, BATCH_SIZE]
    );
    for (const row of rows) await this.publishOne(row.id);
  }

  private async publishOne(id: string): Promise<void> {
    const claim = await this.claim(id);
    if (!claim) return;
    try {
      const redis = await this.getRedisClient();
      if (!redis) throw new Error("REDIS_URL is not configured");
      await redis.publish(SQL_ERD_OPERATION_REDIS_CHANNEL, JSON.stringify(claim.payload));
      await this.database.execute(
        `UPDATE sql_erd_session_operation_outbox SET status = 'delivered', delivered_at = now(), claim_token = NULL, claimed_at = NULL, error_code = NULL, error_message = NULL
         WHERE id = $1 AND status = 'publishing' AND claim_token = $2`,
        [claim.id, claim.claim_token]
      );
    } catch (error) {
      const delayMs = getSqlErdOperationRetryDelayMs(Number(claim.attempt_count));
      if (Number(claim.attempt_count) >= 5) {
        this.logger.warn(`SQLtoERD outbox publish remains unavailable operation_outbox_id=${claim.id} attempts=${claim.attempt_count}`);
      }
      await this.database.execute(
        `UPDATE sql_erd_session_operation_outbox SET status = 'pending', next_attempt_at = $2, claim_token = NULL, claimed_at = NULL, error_code = 'SQL_ERD_OPERATION_PUBLISH_FAILED', error_message = $3
         WHERE id = $1 AND status = 'publishing' AND claim_token = $4`,
        [claim.id, new Date(Date.now() + delayMs), error instanceof Error ? error.message.slice(0, 1000) : "publish failed", claim.claim_token]
      );
    }
  }

  private claim(id: string): Promise<OutboxClaim | null> {
    const claimToken = randomUUID();
    return this.database.transaction((transaction) => transaction.queryOne<OutboxClaim>(
      `WITH candidate AS (
         SELECT id FROM sql_erd_session_operation_outbox
         WHERE id = $1 AND ((status = 'pending' AND next_attempt_at <= now()) OR (status = 'publishing' AND claimed_at <= now() - ($2 * INTERVAL '1 second')))
         FOR UPDATE SKIP LOCKED
       )
       UPDATE sql_erd_session_operation_outbox AS outbox
       SET status = 'publishing', attempt_count = attempt_count + 1, claim_token = $3, claimed_at = now()
       FROM candidate, sql_erd_session_operations AS operation
       WHERE outbox.id = candidate.id AND operation.id = outbox.operation_id
       RETURNING outbox.id, outbox.claim_token, outbox.attempt_count, jsonb_build_object(
         'id', operation.id, 'workspaceId', operation.workspace_id, 'sessionId', operation.session_id,
         'actorUserId', operation.actor_user_id, 'type', operation.operation_type, 'opSeq', operation.op_seq,
         'clientOperationId', operation.client_operation_id, 'baseRevision', operation.base_revision,
         'appliedOnRevision', operation.applied_on_revision, 'resultRevision', operation.result_revision,
         'rebased', operation.base_revision <> operation.applied_on_revision,
         'createdAt', to_char(operation.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       ) || CASE
         WHEN operation.operation_type = 'layout_patch'
           THEN jsonb_build_object('patch', operation.payload)
         ELSE jsonb_build_object('sourceSnapshotId', operation.source_snapshot_id)
       END AS payload`,
      [id, CLAIM_TIMEOUT_SECONDS, claimToken]
    ));
  }

  private async getRedisClient(): Promise<RedisClientType | null> {
    const url = process.env.REDIS_URL?.trim();
    if (!url) return null;
    if (this.redisClient && this.redisUrl === url) return this.redisClient;
    await this.redisClient?.quit();
    const client = createClient({ url });
    client.on("error", (error) => this.logger.error("SQLtoERD Redis publish failed", error));
    await client.connect();
    this.redisClient = client as RedisClientType;
    this.redisUrl = url;
    return this.redisClient;
  }
}
