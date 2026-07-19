import { randomUUID } from "node:crypto";
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit
} from "@nestjs/common";
import { QueryResultRow } from "pg";
import { DatabaseService } from "../../database/database.service";
import { AgentJobService } from "./agent-job.service";

const SWEEP_INTERVAL_MS = 15_000;
const CLAIM_TIMEOUT_SECONDS = 60;
const SWEEP_BATCH_SIZE = 20;
const MAX_PUBLISH_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [60_000, 120_000, 240_000, 480_000];
const GROUNDED_ANSWER_TIMEOUT_SECONDS = positiveIntegerEnvironment(
  "AGENT_GROUNDED_ANSWER_TIMEOUT_SECONDS",
  300
);
const PUBLISH_FAILURE_CODE = "AGENT_GROUNDED_ANSWER_OUTBOX_PUBLISH_FAILED";
const PUBLISH_FAILURE_MESSAGE =
  "Agent grounded answer job could not be published";
const TIMEOUT_CODE = "AGENT_GROUNDED_ANSWER_TIMEOUT";
const USER_FAILURE_MESSAGE =
  "회의록 근거 답변을 생성하지 못했습니다. 잠시 후 다시 시도해주세요.";

interface GroundedAnswerClaimRow extends QueryResultRow {
  id: string;
  run_id: string;
  workspace_id: string;
  attempt_count: number | string;
  claim_token: string;
}

function positiveIntegerEnvironment(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

@Injectable()
export class AgentGroundedAnswerOutboxPublisherService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    AgentGroundedAnswerOutboxPublisherService.name
  );
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly database: DatabaseService,
    private readonly jobs: AgentJobService
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.publishDue().catch((error: unknown) =>
        this.logger.error("Grounded answer outbox sweep failed", error)
      );
    }, SWEEP_INTERVAL_MS);
    void this.publishDue().catch((error: unknown) =>
      this.logger.error("Initial grounded answer outbox sweep failed", error)
    );
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async publishDue(): Promise<void> {
    await this.recoverStaleRuns();
    const rows = await this.database.query<{ run_id: string }>(
      `
        SELECT outbox.run_id
        FROM agent_grounded_answer_outbox AS outbox
        JOIN agent_runs AS run ON run.id = outbox.run_id
        WHERE run.status = 'running'
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
      [CLAIM_TIMEOUT_SECONDS, SWEEP_BATCH_SIZE]
    );
    for (const row of rows) {
      await this.publish(row.run_id);
    }
  }

  async publish(runId: string): Promise<void> {
    const claim = await this.claim(runId);
    if (!claim) {
      return;
    }

    try {
      await this.jobs.enqueueAgentGroundedAnswerRequestedJob({
        jobType: "agent_grounded_answer_requested",
        runId
      });
      await this.markDelivered(claim);
    } catch {
      await this.markPublishFailure(claim);
    }
  }

  async recoverStaleRuns(): Promise<number> {
    const rows = await this.database.query<{ id: string }>(
      `
        WITH candidates AS (
          SELECT run.id, run.workspace_id, outbox.id AS outbox_id
          FROM agent_runs AS run
          JOIN agent_grounded_answer_outbox AS outbox ON outbox.run_id = run.id
          WHERE run.status = 'running'
            AND outbox.created_at <= now() - ($1 * INTERVAL '1 second')
            AND outbox.status IN ('pending', 'publishing', 'delivered')
          ORDER BY outbox.created_at ASC
          FOR UPDATE OF run, outbox SKIP LOCKED
          LIMIT $2
        ), failed_runs AS (
          UPDATE agent_runs AS run
          SET status = 'failed',
              error_code = $3,
              error_message = $4,
              message = $4,
              completed_at = now(),
              execution_lease_token = NULL,
              execution_lease_expires_at = NULL,
              execution_heartbeat_at = NULL,
              updated_at = now()
          FROM candidates
          WHERE run.id = candidates.id
            AND run.status = 'running'
          RETURNING run.id, run.workspace_id, candidates.outbox_id
        ), failed_outbox AS (
          UPDATE agent_grounded_answer_outbox AS outbox
          SET status = 'failed',
              claim_token = NULL,
              claimed_at = NULL,
              error_code = $3,
              error_message = $4,
              updated_at = now()
          FROM failed_runs
          WHERE outbox.id = failed_runs.outbox_id
          RETURNING outbox.run_id
        ), failed_steps AS (
          UPDATE agent_steps AS step
          SET status = 'failed',
              error_code = $3,
              error_message = $4,
              completed_at = now(),
              updated_at = now()
          FROM failed_runs
          WHERE step.run_id = failed_runs.id
            AND step.step_type = 'answer'
            AND step.status = 'pending'
          RETURNING step.run_id
        ), logged AS (
          INSERT INTO agent_logs (
            workspace_id, run_id, actor_type, level, event_type, message,
            metadata_json, resource_refs
          )
          SELECT workspace_id, id, 'system', 'error',
                 'grounded_answer_timeout',
                 'Agent grounded answer deadline exceeded',
                 jsonb_build_object('timeoutSeconds', $1),
                 '[]'::jsonb
          FROM failed_runs
          RETURNING run_id
        )
        SELECT id FROM failed_runs
      `,
      [
        GROUNDED_ANSWER_TIMEOUT_SECONDS,
        SWEEP_BATCH_SIZE,
        TIMEOUT_CODE,
        USER_FAILURE_MESSAGE
      ]
    );
    return rows.length;
  }

  private async claim(runId: string): Promise<GroundedAnswerClaimRow | null> {
    const token = randomUUID();
    return this.database.queryOne<GroundedAnswerClaimRow>(
      `
        UPDATE agent_grounded_answer_outbox AS outbox
        SET status = 'publishing',
            attempt_count = outbox.attempt_count + 1,
            claim_token = $2::uuid,
            claimed_at = now()
        FROM agent_runs AS run
        WHERE outbox.run_id = $1
          AND run.id = outbox.run_id
          AND run.status = 'running'
          AND (
            (outbox.status = 'pending' AND outbox.next_attempt_at <= now())
            OR (
              outbox.status = 'publishing'
              AND outbox.claimed_at <= now() - ($3 * INTERVAL '1 second')
            )
          )
        RETURNING outbox.id, outbox.run_id, outbox.workspace_id,
                  outbox.attempt_count, outbox.claim_token
      `,
      [runId, token, CLAIM_TIMEOUT_SECONDS]
    );
  }

  private async markDelivered(claim: GroundedAnswerClaimRow): Promise<void> {
    await this.database.execute(
      `
        UPDATE agent_grounded_answer_outbox
        SET status = 'delivered',
            delivered_at = now(),
            claim_token = NULL,
            claimed_at = NULL,
            error_code = NULL,
            error_message = NULL
        WHERE id = $1
          AND status = 'publishing'
          AND claim_token = $2::uuid
      `,
      [claim.id, claim.claim_token]
    );
  }

  private async markPublishFailure(
    claim: GroundedAnswerClaimRow
  ): Promise<void> {
    const attemptCount = Number(claim.attempt_count);
    if (attemptCount < MAX_PUBLISH_ATTEMPTS) {
      await this.database.execute(
        `
          UPDATE agent_grounded_answer_outbox
          SET status = 'pending',
              next_attempt_at = $3,
              claim_token = NULL,
              claimed_at = NULL,
              error_code = $4,
              error_message = $5
          WHERE id = $1
            AND status = 'publishing'
            AND claim_token = $2::uuid
        `,
        [
          claim.id,
          claim.claim_token,
          new Date(Date.now() + RETRY_DELAYS_MS[attemptCount - 1]),
          PUBLISH_FAILURE_CODE,
          PUBLISH_FAILURE_MESSAGE
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
          UPDATE agent_grounded_answer_outbox
          SET status = 'failed',
              claim_token = NULL,
              claimed_at = NULL,
              error_code = $3,
              error_message = $4,
              updated_at = now()
          WHERE id = $1
            AND status = 'publishing'
            AND claim_token = $2::uuid
          RETURNING run_id, workspace_id
        `,
        [
          claim.id,
          claim.claim_token,
          PUBLISH_FAILURE_CODE,
          PUBLISH_FAILURE_MESSAGE
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
              completed_at = now(),
              execution_lease_token = NULL,
              execution_lease_expires_at = NULL,
              execution_heartbeat_at = NULL,
              updated_at = now()
          WHERE id = $1
            AND workspace_id = $5
            AND status = 'running'
          RETURNING id
        `,
        [
          outbox.run_id,
          PUBLISH_FAILURE_CODE,
          PUBLISH_FAILURE_MESSAGE,
          USER_FAILURE_MESSAGE,
          outbox.workspace_id
        ]
      );
      if (!run) {
        return false;
      }

      await transaction.execute(
        `
          UPDATE agent_steps
          SET status = 'failed',
              error_code = $2,
              error_message = $3,
              completed_at = now(),
              updated_at = now()
          WHERE run_id = $1
            AND step_type = 'answer'
            AND status = 'pending'
        `,
        [outbox.run_id, PUBLISH_FAILURE_CODE, PUBLISH_FAILURE_MESSAGE]
      );
      await transaction.execute(
        `
          INSERT INTO agent_logs (
            workspace_id, run_id, actor_type, level, event_type, message,
            metadata_json, resource_refs
          )
          VALUES ($1, $2, 'system', 'error',
                  'grounded_answer_outbox_publish_exhausted', $3, $4::jsonb,
                  '[]'::jsonb)
        `,
        [
          outbox.workspace_id,
          outbox.run_id,
          "Agent grounded answer outbox retries exhausted",
          JSON.stringify({ attempts: attemptCount })
        ]
      );
      return true;
    });

    if (failed) {
      this.logger.warn(
        `Grounded answer outbox retries exhausted for run ${claim.run_id}`
      );
    }
  }
}
