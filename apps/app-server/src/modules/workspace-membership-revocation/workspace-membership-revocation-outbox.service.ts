import { randomUUID } from "node:crypto";
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import {
  DatabaseService,
  DatabaseTransaction
} from "../../database/database.service";
import { WorkspaceMembershipRevocationPublisherService } from "./workspace-membership-revocation-publisher.service";

const CLAIM_TIMEOUT_SECONDS = 60;
const SWEEP_INTERVAL_MS = 1_000;
const BATCH_SIZE = 50;
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 60_000];

type WorkspaceMembershipRevocationOutboxClaim = {
  attempt_count: number | string;
  claim_token: string;
  id: string;
  occurred_at: string;
  user_id: string;
  workspace_id: string;
};

export function getWorkspaceMembershipRevocationRetryDelayMs(
  attemptCount: number
): number {
  const index = Math.max(
    0,
    Math.min(attemptCount - 1, RETRY_DELAYS_MS.length - 1)
  );
  return RETRY_DELAYS_MS[index];
}

@Injectable()
export class WorkspaceMembershipRevocationOutboxService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    WorkspaceMembershipRevocationOutboxService.name
  );
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly database: DatabaseService,
    private readonly publisher: WorkspaceMembershipRevocationPublisherService
  ) {}

  onModuleInit(): void {
    if (process.env.APP_SERVER_RUNTIME === "github-sync-worker") return;

    this.interval = setInterval(() => {
      void this.publishDue().catch(() => {
        this.logger.error("Workspace membership revocation outbox sweep failed");
      });
    }, SWEEP_INTERVAL_MS);
    void this.publishDue().catch(() => {
      this.logger.error("Initial Workspace membership revocation outbox sweep failed");
    });
  }

  onModuleDestroy(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  async enqueueMembershipRevoked(
    transaction: DatabaseTransaction,
    workspaceId: string,
    userId: string
  ): Promise<string> {
    const row = await transaction.queryOne<{ id: string }>(
      `
        INSERT INTO workspace_membership_revocation_outbox (
          workspace_id,
          user_id
        )
        VALUES ($1::uuid, $2::uuid)
        RETURNING id
      `,
      [workspaceId, userId]
    );
    if (!row) {
      throw new Error("Workspace membership revocation outbox could not be created");
    }
    return row.id;
  }

  async publishOutbox(id: string): Promise<void> {
    let claim: WorkspaceMembershipRevocationOutboxClaim | null = null;
    try {
      claim = await this.claim(id);
      if (!claim) return;

      const published = await this.publisher.publishMembershipRevoked({
        version: 1,
        type: "membership.revoked",
        workspaceId: claim.workspace_id,
        userId: claim.user_id,
        occurredAt: claim.occurred_at
      });
      if (!published) {
        await this.markPublishFailure(claim);
        return;
      }

      await this.database.execute(
        `
          UPDATE workspace_membership_revocation_outbox
          SET
            status = 'delivered',
            delivered_at = now(),
            claim_token = NULL,
            claimed_at = NULL,
            last_error_code = NULL
          WHERE id = $1::uuid
            AND status = 'publishing'
            AND claim_token = $2::uuid
        `,
        [claim.id, claim.claim_token]
      );
    } catch {
      if (claim) {
        await this.markPublishFailure(claim).catch(() => undefined);
      }
      this.logger.error("Workspace membership revocation outbox publish failed");
    }
  }

  async publishDue(): Promise<void> {
    const rows = await this.database.query<{ id: string }>(
      `
        SELECT id
        FROM workspace_membership_revocation_outbox
        WHERE (status = 'pending' AND next_attempt_at <= now())
          OR (
            status = 'publishing'
            AND claimed_at <= now() - ($1 * INTERVAL '1 second')
          )
        ORDER BY next_attempt_at ASC
        LIMIT $2
      `,
      [CLAIM_TIMEOUT_SECONDS, BATCH_SIZE]
    );
    for (const row of rows) {
      await this.publishOutbox(row.id);
    }
  }

  private claim(
    id: string
  ): Promise<WorkspaceMembershipRevocationOutboxClaim | null> {
    const claimToken = randomUUID();
    return this.database.transaction(transaction =>
      transaction.queryOne<WorkspaceMembershipRevocationOutboxClaim>(
        `
          WITH candidate AS (
            SELECT id
            FROM workspace_membership_revocation_outbox
            WHERE id = $1::uuid
              AND (
                (status = 'pending' AND next_attempt_at <= now())
                OR (
                  status = 'publishing'
                  AND claimed_at <= now() - ($2 * INTERVAL '1 second')
                )
              )
            FOR UPDATE SKIP LOCKED
          )
          UPDATE workspace_membership_revocation_outbox AS outbox
          SET
            status = 'publishing',
            attempt_count = outbox.attempt_count + 1,
            claim_token = $3::uuid,
            claimed_at = now()
          FROM candidate
          WHERE outbox.id = candidate.id
          RETURNING
            outbox.id,
            outbox.workspace_id,
            outbox.user_id,
            outbox.claim_token,
            outbox.attempt_count,
            to_char(
              outbox.occurred_at AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            ) AS occurred_at
        `,
        [id, CLAIM_TIMEOUT_SECONDS, claimToken]
      )
    );
  }

  private async markPublishFailure(
    claim: WorkspaceMembershipRevocationOutboxClaim
  ): Promise<void> {
    const delayMs = getWorkspaceMembershipRevocationRetryDelayMs(
      Number(claim.attempt_count)
    );
    await this.database.execute(
      `
        UPDATE workspace_membership_revocation_outbox
        SET
          status = 'pending',
          next_attempt_at = $2,
          claim_token = NULL,
          claimed_at = NULL,
          last_error_code = 'WORKSPACE_MEMBERSHIP_REVOCATION_PUBLISH_FAILED'
        WHERE id = $1::uuid
          AND status = 'publishing'
          AND claim_token = $3::uuid
      `,
      [claim.id, new Date(Date.now() + delayMs), claim.claim_token]
    );
  }
}
