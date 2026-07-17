import { randomUUID } from "node:crypto";
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit
} from "@nestjs/common";
import { QueryResultRow } from "pg";
import { DatabaseService } from "../../database/database.service";
import {
  AGENT_TOOL_SCHEMA_VERSION,
  AgentJobService,
  AgentToolSchemaSnapshotItem
} from "./agent-job.service";
import { AgentToolRegistryService } from "./agent-tool-registry.service";
import type { AgentRunRequestContext } from "./types/agent-tool.types";

const OUTBOX_SWEEP_INTERVAL_MS = 60_000;
const OUTBOX_CLAIM_TIMEOUT_SECONDS = 60;
const OUTBOX_SWEEP_BATCH_SIZE = 20;
const OUTBOX_MAX_RETRIES = 5;
const OUTBOX_RETRY_DELAYS_MS = [60_000, 120_000, 240_000, 480_000, 960_000];
const OUTBOX_PUBLISH_FAILURE_CODE = "AGENT_OUTBOX_PUBLISH_FAILED";
const OUTBOX_PUBLISH_FAILURE_MESSAGE =
  "Agent planning job could not be published";
const OUTBOX_RUN_FAILURE_MESSAGE =
  "요청을 시작하지 못했습니다. 잠시 후 다시 시도해주세요.";

interface AgentOutboxClaimRow extends QueryResultRow {
  id: string;
  run_id: string;
  workspace_id: string;
  requested_by_user_id: string;
  request_context_json: AgentRunRequestContext;
  attempt_count: number | string;
  claim_token: string;
  turn_sequence: number | string;
}

@Injectable()
export class AgentOutboxPublisherService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AgentOutboxPublisherService.name);
  private sweepInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly database: DatabaseService,
    private readonly agentJobService: AgentJobService,
    private readonly agentToolRegistryService: AgentToolRegistryService
  ) {}

  onModuleInit(): void {
    this.sweepInterval = setInterval(() => {
      void this.publishDueEvents().catch((error: unknown) => {
        this.logger.error("Agent outbox recovery sweep failed", error);
      });
    }, OUTBOX_SWEEP_INTERVAL_MS);

    void this.publishDueEvents().catch((error: unknown) => {
      this.logger.error("Initial Agent outbox recovery sweep failed", error);
    });
  }

  onModuleDestroy(): void {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
    }
  }

  async publishCreatedRun(runId: string): Promise<void> {
    try {
      await this.publishOne(runId);
    } catch (error) {
      this.logger.error(
        `Immediate Agent outbox publish attempt failed for run ${runId}`,
        error
      );
    }
  }

  async publishDueEvents(): Promise<void> {
    const rows = await this.database.query<{ run_id: string }>(
      `
        SELECT outbox.run_id
        FROM agent_run_outbox AS outbox
        JOIN agent_runs AS run
          ON run.id = outbox.run_id
          AND run.workspace_id = outbox.workspace_id
        WHERE run.status = 'planning'
          AND (
            (outbox.status = 'pending' AND outbox.next_attempt_at <= now())
            OR (
              outbox.status = 'publishing'
              AND outbox.claimed_at <= now() - ($1 * INTERVAL '1 second')
            )
          )
        ORDER BY outbox.next_attempt_at ASC
        LIMIT $2
      `,
      [OUTBOX_CLAIM_TIMEOUT_SECONDS, OUTBOX_SWEEP_BATCH_SIZE]
    );

    for (const row of rows) {
      await this.publishOne(row.run_id);
    }
  }

  private async publishOne(runId: string): Promise<void> {
    const claim = await this.claimDueEvent(runId);

    if (!claim) {
      return;
    }

    try {
      await this.agentJobService.enqueueAgentRunRequestedJob({
        jobType: "agent_run_requested",
        runId: claim.run_id,
        workspaceId: claim.workspace_id,
        requestedByUserId: claim.requested_by_user_id,
        requestContext: claim.request_context_json,
        turnSequence: Number(claim.turn_sequence),
        toolSchemaVersion: AGENT_TOOL_SCHEMA_VERSION,
        tools: this.buildToolSchemaSnapshot(claim.request_context_json)
      });
      await this.markDelivered(claim);
    } catch {
      await this.markPublishFailure(claim);
    }
  }

  private async claimDueEvent(
    runId: string
  ): Promise<AgentOutboxClaimRow | null> {
    const claimToken = randomUUID();

    return this.database.transaction(async (transaction) =>
      transaction.queryOne<AgentOutboxClaimRow>(
        `
          WITH candidate AS (
            SELECT outbox.id
            FROM agent_run_outbox AS outbox
            JOIN agent_runs AS run
              ON run.id = outbox.run_id
              AND run.workspace_id = outbox.workspace_id
            WHERE outbox.run_id = $1
              AND run.status = 'planning'
              AND run.requested_by_user_id IS NOT NULL
              AND (
                (outbox.status = 'pending' AND outbox.next_attempt_at <= now())
                OR (
                  outbox.status = 'publishing'
                  AND outbox.claimed_at <= now() - ($2 * INTERVAL '1 second')
                )
              )
            FOR UPDATE OF outbox SKIP LOCKED
          )
          UPDATE agent_run_outbox AS outbox
          SET status = 'publishing',
              attempt_count = outbox.attempt_count + 1,
              claim_token = $3,
              claimed_at = now()
          FROM candidate, agent_runs AS run
          WHERE outbox.id = candidate.id
            AND run.id = outbox.run_id
            AND run.workspace_id = outbox.workspace_id
          RETURNING
            outbox.id,
            outbox.run_id,
            outbox.workspace_id,
            run.requested_by_user_id,
            run.request_context_json,
            outbox.attempt_count,
            outbox.claim_token,
            outbox.turn_sequence
        `,
        [runId, OUTBOX_CLAIM_TIMEOUT_SECONDS, claimToken]
      )
    );
  }

  private async markDelivered(claim: AgentOutboxClaimRow): Promise<void> {
    await this.database.execute(
      `
        UPDATE agent_run_outbox
        SET status = 'delivered',
            delivered_at = now(),
            claim_token = NULL,
            claimed_at = NULL,
            error_code = NULL,
            error_message = NULL
        WHERE id = $1
          AND status = 'publishing'
          AND claim_token = $2
      `,
      [claim.id, claim.claim_token]
    );
  }

  private async markPublishFailure(claim: AgentOutboxClaimRow): Promise<void> {
    const attemptCount = Number(claim.attempt_count);

    if (attemptCount <= OUTBOX_MAX_RETRIES) {
      const retryDelayMs = OUTBOX_RETRY_DELAYS_MS[attemptCount - 1];
      await this.database.execute(
        `
          UPDATE agent_run_outbox
          SET status = 'pending',
              next_attempt_at = $2,
              claim_token = NULL,
              claimed_at = NULL,
              error_code = $3,
              error_message = $4
          WHERE id = $1
            AND status = 'publishing'
            AND claim_token = $5
        `,
        [
          claim.id,
          new Date(Date.now() + retryDelayMs),
          OUTBOX_PUBLISH_FAILURE_CODE,
          OUTBOX_PUBLISH_FAILURE_MESSAGE,
          claim.claim_token
        ]
      );
      return;
    }

    const failed = await this.database.transaction(async (transaction) => {
      const outbox = await transaction.queryOne<{
        run_id: string;
        workspace_id: string;
      }>(
        `
          UPDATE agent_run_outbox
          SET status = 'failed',
              claim_token = NULL,
              claimed_at = NULL,
              error_code = $2,
              error_message = $3
          WHERE id = $1
            AND status = 'publishing'
            AND claim_token = $4
          RETURNING run_id, workspace_id
        `,
        [
          claim.id,
          OUTBOX_PUBLISH_FAILURE_CODE,
          OUTBOX_PUBLISH_FAILURE_MESSAGE,
          claim.claim_token
        ]
      );

      if (!outbox) {
        return false;
      }

      const run = await transaction.queryOne<{ id: string }>(
        `
          UPDATE agent_runs
          SET status = 'failed',
              error_code = $2,
              error_message = $3,
              message = $4,
              completed_at = now()
          WHERE id = $1
            AND workspace_id = $5
            AND status = 'planning'
          RETURNING id
        `,
        [
          outbox.run_id,
          OUTBOX_PUBLISH_FAILURE_CODE,
          OUTBOX_PUBLISH_FAILURE_MESSAGE,
          OUTBOX_RUN_FAILURE_MESSAGE,
          outbox.workspace_id
        ]
      );

      if (!run) {
        return false;
      }

      await transaction.execute(
        `
          INSERT INTO agent_logs (
            workspace_id,
            run_id,
            actor_type,
            level,
            event_type,
            message,
            metadata_json,
            resource_refs
          )
          VALUES ($1, $2, 'system', 'error', 'outbox_publish_exhausted', $3, $4::jsonb, '[]'::jsonb)
        `,
        [
          outbox.workspace_id,
          outbox.run_id,
          "Agent outbox publish retries exhausted",
          JSON.stringify({ attempts: attemptCount })
        ]
      );

      return true;
    });

    if (failed) {
      this.logger.warn(
        `Agent outbox publish retries exhausted for run ${claim.run_id}`
      );
    }
  }

  private buildToolSchemaSnapshot(
    requestContext: AgentRunRequestContext
  ): AgentToolSchemaSnapshotItem[] {
    return this.agentToolRegistryService
      .listDefinitionsForContext(requestContext)
      .map((definition) => ({
      name: definition.name,
      description: definition.description,
      riskLevel: definition.riskLevel,
      executionMode: definition.executionMode,
      inputSchema: definition.inputSchema
      }));
  }
}
