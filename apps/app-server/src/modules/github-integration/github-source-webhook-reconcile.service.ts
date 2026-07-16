import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import {
  DatabaseService,
  type DatabaseTransaction
} from "../../database/database.service";
import {
  GithubAppClient,
  GithubSourceSnapshotNotFoundError,
  type GithubIssueApiItem,
  type GithubPullRequestApiItem
} from "./github-app.client";
import {
  GithubBoardInvalidationPublisherService,
  type BoardInvalidationPayload
} from "./github-board-invalidation-publisher.service";
import { GithubIntegrationConfigService } from "./github-integration-config.service";
import { serializeGithubJsonb } from "./github-jsonb";
import {
  GithubSourceInvalidationPublisherService,
  type GithubSourceInvalidationPayload
} from "./github-source-invalidation-publisher.service";
import type { GithubSourceWebhookKind } from "./github-source-webhook-context";

interface GithubSourceWebhookDeliveryClaim extends QueryResultRow {
  content_number: string;
  delivery_id: string;
  event_name: string;
  github_installation_id: string | number;
  github_repository_id: string;
}

interface GithubSourceWebhookTarget extends QueryResultRow {
  github_installation_id: string | number;
  repository_id: string;
  repository_name: string;
  repository_owner_login: string;
  workspace_id: string;
}

interface UpsertedSourceRow extends QueryResultRow {
  id: string;
  updated_at: Date | string;
}

interface BoardHydrationTarget extends QueryResultRow {
  board_id: string | number;
  project_v2_id: string;
  repository_id: string;
}

interface HydratedBoardRow extends QueryResultRow {
  board_id: string | number;
  updated_at: Date | string;
}

interface GithubSourceReconcileResult {
  boardInvalidations: BoardInvalidationPayload[];
  sourceInvalidations: GithubSourceInvalidationPayload[];
}

const SOURCE_WEBHOOK_RECONCILE_ERROR_MESSAGE =
  "GitHub source webhook reconcile failed";

@Injectable()
export class GithubSourceWebhookReconcileService {
  private readonly workerId =
    `${process.env.HOSTNAME ?? "github-sync-worker"}-${process.pid}`;

  constructor(
    private readonly database: DatabaseService,
    private readonly configService: GithubIntegrationConfigService,
    private readonly githubAppClient: GithubAppClient,
    private readonly sourceInvalidationPublisher: GithubSourceInvalidationPublisherService,
    private readonly boardInvalidationPublisher: GithubBoardInvalidationPublisherService
  ) {}

  async processDelivery(deliveryId: string): Promise<"terminal" | "retry"> {
    let claim: GithubSourceWebhookDeliveryClaim | null;
    try {
      claim = await this.claimDelivery(deliveryId);
    } catch {
      return "retry";
    }

    if (!claim) {
      return "terminal";
    }

    try {
      const kind = this.readKind(claim.event_name);
      const contentNumber = this.toPositiveInteger(claim.content_number);
      const result = await this.database.transaction(async (transaction) => {
        await this.acquireSourceLock(transaction, claim, kind, contentNumber);
        const targets = await this.listTargets(transaction, claim);
        if (targets.length === 0) {
          await this.markProcessed(transaction, claim);
          return this.emptyReconcileResult();
        }

        try {
          const result = await this.reconcileSource(
            transaction,
            targets,
            kind,
            contentNumber
          );
          await this.markProcessed(transaction, claim);
          return result;
        } catch (error) {
          if (error instanceof GithubSourceSnapshotNotFoundError) {
            await this.markProcessed(transaction, claim);
            return this.emptyReconcileResult();
          }
          throw error;
        }
      });

      for (const payload of result.boardInvalidations) {
        await this.publishBoardInvalidationBestEffort(payload);
      }
      for (const payload of result.sourceInvalidations) {
        await this.publishSourceInvalidationBestEffort(payload);
      }
      return "terminal";
    } catch {
      try {
        await this.releaseForRetry(claim);
      } catch {
        // DB recovery can reclaim the delivery after its lease expires.
      }
      return "retry";
    }
  }

  private async acquireSourceLock(
    transaction: DatabaseTransaction,
    claim: GithubSourceWebhookDeliveryClaim,
    kind: GithubSourceWebhookKind,
    contentNumber: number
  ): Promise<void> {
    const lockKey = [
      "github-source-webhook",
      String(claim.github_installation_id),
      claim.github_repository_id,
      kind,
      String(contentNumber)
    ].join(":");
    await transaction.execute(
      "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
      [lockKey]
    );
  }

  private async reconcileSource(
    transaction: DatabaseTransaction,
    targets: GithubSourceWebhookTarget[],
    kind: GithubSourceWebhookKind,
    contentNumber: number
  ): Promise<GithubSourceReconcileResult> {
    const config = this.configService.getGithubAppConfig();
    const firstTarget = targets[0];
    const request = {
      appId: config.appId,
      installationId: this.toPositiveInteger(firstTarget.github_installation_id),
      now: config.now,
      owner: firstTarget.repository_owner_login,
      privateKey: config.privateKey,
      repo: firstTarget.repository_name
    };
    const result = this.emptyReconcileResult();

    if (kind === "issue") {
      const issue = await this.githubAppClient.getRepositoryIssue({
        ...request,
        issueNumber: contentNumber
      });
      for (const target of targets) {
        const row = await this.upsertIssue(transaction, target, issue);
        result.boardInvalidations.push(
          ...(await this.hydrateIssueBoards(transaction, target, row.id))
        );
        result.sourceInvalidations.push({
          repositoryId: target.repository_id,
          sourceId: row.id,
          sourceNumber: issue.number,
          sourceType: kind,
          updatedAt: this.toIsoString(row.updated_at),
          workspaceId: target.workspace_id
        });
      }
      return result;
    }

    const pullRequest =
      await this.githubAppClient.getPullRequestWebhookSnapshot({
        ...request,
        pullNumber: contentNumber
      });
    for (const target of targets) {
      const row = await this.upsertPullRequest(
        transaction,
        target,
        pullRequest
      );
      result.sourceInvalidations.push({
        repositoryId: target.repository_id,
        sourceId: row.id,
        sourceNumber: pullRequest.number,
        sourceType: kind,
        updatedAt: this.toIsoString(row.updated_at),
        workspaceId: target.workspace_id
      });
    }
    return result;
  }

  private emptyReconcileResult(): GithubSourceReconcileResult {
    return { boardInvalidations: [], sourceInvalidations: [] };
  }

  private async claimDelivery(
    deliveryId: string
  ): Promise<GithubSourceWebhookDeliveryClaim | null> {
    return this.database.queryOne<GithubSourceWebhookDeliveryClaim>(
      `
        UPDATE github_webhook_deliveries
        SET
          status='processing',
          attempt_count=attempt_count+1,
          lease_owner=$2,
          lease_expires_at=now() + interval '10 minutes',
          processed_at=NULL,
          error_message=NULL
        WHERE delivery_id=$1
          AND (
            (status='received' AND (lease_expires_at IS NULL OR lease_expires_at < now()))
            OR (status='processing' AND lease_expires_at < now())
          )
        RETURNING
          delivery_id,
          event_name,
          github_installation_id,
          project_v2_node_id AS github_repository_id,
          project_item_node_id AS content_number
      `,
      [deliveryId, this.workerId]
    );
  }

  private async listTargets(
    transaction: DatabaseTransaction,
    claim: GithubSourceWebhookDeliveryClaim
  ): Promise<GithubSourceWebhookTarget[]> {
    return transaction.query<GithubSourceWebhookTarget>(
      `
        SELECT
          installation.workspace_id,
          installation.github_installation_id,
          repository.id AS repository_id,
          repository.owner_login AS repository_owner_login,
          repository.name AS repository_name
        FROM github_installations AS installation
        JOIN github_repositories AS repository
          ON repository.workspace_id=installation.workspace_id
          AND repository.installation_id=installation.id
        WHERE installation.github_installation_id=$1
          AND repository.github_repository_id=$2
        ORDER BY installation.workspace_id ASC, repository.id ASC
      `,
      [claim.github_installation_id, claim.github_repository_id]
    );
  }

  private async upsertIssue(
    transaction: DatabaseTransaction,
    target: GithubSourceWebhookTarget,
    issue: GithubIssueApiItem
  ): Promise<UpsertedSourceRow> {
    const row = await transaction.queryOne<UpsertedSourceRow>(
      `
        INSERT INTO github_issues (
          workspace_id, repository_id, github_issue_id, github_node_id,
          issue_number, title, body, state, state_reason, author_login,
          author_avatar_url, html_url, labels, assignees, milestone,
          github_created_at, github_updated_at, github_closed_at,
          last_synced_at, raw
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13::jsonb, $14::jsonb, $15::jsonb,
          $16, $17, $18, now(), $19::jsonb
        )
        ON CONFLICT (workspace_id, github_issue_id)
        DO UPDATE SET
          repository_id=EXCLUDED.repository_id,
          github_node_id=EXCLUDED.github_node_id,
          issue_number=EXCLUDED.issue_number,
          title=EXCLUDED.title,
          body=EXCLUDED.body,
          state=EXCLUDED.state,
          state_reason=EXCLUDED.state_reason,
          author_login=EXCLUDED.author_login,
          author_avatar_url=EXCLUDED.author_avatar_url,
          html_url=EXCLUDED.html_url,
          labels=EXCLUDED.labels,
          assignees=EXCLUDED.assignees,
          milestone=EXCLUDED.milestone,
          github_created_at=EXCLUDED.github_created_at,
          github_updated_at=EXCLUDED.github_updated_at,
          github_closed_at=EXCLUDED.github_closed_at,
          last_synced_at=now(),
          raw=EXCLUDED.raw,
          updated_at=now()
        RETURNING id, updated_at
      `,
      [
        target.workspace_id,
        target.repository_id,
        issue.id,
        issue.node_id,
        issue.number,
        issue.title,
        issue.body ?? null,
        issue.state,
        issue.state_reason ?? null,
        issue.user?.login ?? null,
        issue.user?.avatar_url ?? null,
        issue.html_url,
        serializeGithubJsonb(issue.labels ?? []),
        serializeGithubJsonb(issue.assignees ?? []),
        serializeGithubJsonb(issue.milestone ?? null),
        issue.created_at ?? null,
        issue.updated_at ?? null,
        issue.closed_at ?? null,
        serializeGithubJsonb(issue)
      ]
    );
    if (!row) {
      throw new Error(SOURCE_WEBHOOK_RECONCILE_ERROR_MESSAGE);
    }
    return row;
  }

  private async upsertPullRequest(
    transaction: DatabaseTransaction,
    target: GithubSourceWebhookTarget,
    pullRequest: GithubPullRequestApiItem
  ): Promise<UpsertedSourceRow> {
    const row = await transaction.queryOne<UpsertedSourceRow>(
      `
        INSERT INTO github_pull_requests (
          workspace_id, repository_id, github_pull_request_id, github_node_id,
          pr_number, title, body, author_login, author_avatar_url,
          head_branch, base_branch, changed_files_count, additions, deletions,
          commits_count, comments_count, review_comments_count, html_url,
          github_created_at, github_updated_at, github_closed_at, merged_at,
          last_synced_at, raw
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
          $13, $14, $15, $16, $17, $18, $19, $20, $21, $22,
          now(), $23::jsonb
        )
        ON CONFLICT (workspace_id, github_pull_request_id)
        DO UPDATE SET
          repository_id=EXCLUDED.repository_id,
          github_node_id=EXCLUDED.github_node_id,
          pr_number=EXCLUDED.pr_number,
          title=EXCLUDED.title,
          body=EXCLUDED.body,
          author_login=EXCLUDED.author_login,
          author_avatar_url=EXCLUDED.author_avatar_url,
          head_branch=EXCLUDED.head_branch,
          base_branch=EXCLUDED.base_branch,
          changed_files_count=EXCLUDED.changed_files_count,
          additions=EXCLUDED.additions,
          deletions=EXCLUDED.deletions,
          commits_count=EXCLUDED.commits_count,
          comments_count=EXCLUDED.comments_count,
          review_comments_count=EXCLUDED.review_comments_count,
          html_url=EXCLUDED.html_url,
          github_created_at=EXCLUDED.github_created_at,
          github_updated_at=EXCLUDED.github_updated_at,
          github_closed_at=EXCLUDED.github_closed_at,
          merged_at=EXCLUDED.merged_at,
          last_synced_at=now(),
          raw=EXCLUDED.raw,
          updated_at=now()
        RETURNING id, updated_at
      `,
      [
        target.workspace_id,
        target.repository_id,
        pullRequest.id,
        pullRequest.node_id,
        pullRequest.number,
        pullRequest.title,
        pullRequest.body ?? null,
        pullRequest.user?.login ?? null,
        pullRequest.user?.avatar_url ?? null,
        pullRequest.head?.ref ?? null,
        pullRequest.base?.ref ?? null,
        pullRequest.changed_files ?? 0,
        pullRequest.additions ?? 0,
        pullRequest.deletions ?? 0,
        pullRequest.commits ?? 0,
        pullRequest.comments ?? 0,
        pullRequest.review_comments ?? 0,
        pullRequest.html_url,
        pullRequest.created_at ?? null,
        pullRequest.updated_at ?? null,
        pullRequest.closed_at ?? null,
        pullRequest.merged_at ?? null,
        serializeGithubJsonb(pullRequest)
      ]
    );
    if (!row) {
      throw new Error(SOURCE_WEBHOOK_RECONCILE_ERROR_MESSAGE);
    }
    return row;
  }

  private async hydrateIssueBoards(
    transaction: DatabaseTransaction,
    target: GithubSourceWebhookTarget,
    issueId: string
  ): Promise<BoardInvalidationPayload[]> {
    const boards = await transaction.query<BoardHydrationTarget>(
      `
        SELECT DISTINCT
          board.id AS board_id,
          board.project_v2_id,
          board.repository_id
        FROM boards AS board
        JOIN github_project_v2_items AS item
          ON item.project_v2_id=board.project_v2_id
          AND item.issue_id=$3
        WHERE board.workspace_id=$1
          AND board.repository_id=$2
        ORDER BY board.id ASC
      `,
      [target.workspace_id, target.repository_id, issueId]
    );

    const invalidations: BoardInvalidationPayload[] = [];
    for (const board of boards) {
      const hydrated = await transaction.queryOne<HydratedBoardRow>(
        `
          WITH hydrated AS (
            SELECT hydrate_pilo_board_from_github($1::uuid, $2::uuid)::text AS board_id
          )
          SELECT hydrated.board_id, board.updated_at
          FROM hydrated
          JOIN boards AS board ON board.id=hydrated.board_id::bigint
          WHERE board.workspace_id=$3
        `,
        [board.project_v2_id, board.repository_id, target.workspace_id]
      );
      if (!hydrated) {
        continue;
      }
      invalidations.push({
        boardId: String(hydrated.board_id),
        updatedAt: this.toIsoString(hydrated.updated_at),
        workspaceId: target.workspace_id
      });
    }
    return invalidations;
  }

  private async publishBoardInvalidationBestEffort(
    payload: BoardInvalidationPayload
  ): Promise<void> {
    try {
      await this.boardInvalidationPublisher.publishInvalidation(payload);
    } catch (error) {
      console.error("Board invalidation publish failed", error);
    }
  }

  private async publishSourceInvalidationBestEffort(
    payload: Parameters<
      GithubSourceInvalidationPublisherService["publishInvalidation"]
    >[0]
  ): Promise<void> {
    try {
      await this.sourceInvalidationPublisher.publishInvalidation(payload);
    } catch (error) {
      console.error("GitHub source invalidation publish failed", error);
    }
  }

  private async markProcessed(
    transaction: DatabaseTransaction,
    claim: GithubSourceWebhookDeliveryClaim
  ): Promise<void> {
    const result = await transaction.execute(
      `
        UPDATE github_webhook_deliveries
        SET status='processed', processed_at=now(), error_message=NULL,
          lease_owner=NULL, lease_expires_at=NULL
        WHERE delivery_id=$1 AND status='processing' AND lease_owner=$2
      `,
      [claim.delivery_id, this.workerId]
    );
    if (result.rowCount !== 1) {
      throw new Error(SOURCE_WEBHOOK_RECONCILE_ERROR_MESSAGE);
    }
  }

  private async releaseForRetry(
    claim: GithubSourceWebhookDeliveryClaim
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE github_webhook_deliveries
        SET status='received', processed_at=NULL, error_message=$3,
          lease_owner=NULL, lease_expires_at=now() + interval '6 minutes'
        WHERE delivery_id=$1 AND status='processing' AND lease_owner=$2
      `,
      [claim.delivery_id, this.workerId, SOURCE_WEBHOOK_RECONCILE_ERROR_MESSAGE]
    );
  }

  private readKind(eventName: string): GithubSourceWebhookKind {
    if (eventName === "issues") {
      return "issue";
    }
    if (
      eventName === "issue_comment" ||
      eventName === "pull_request" ||
      eventName === "pull_request_review" ||
      eventName === "pull_request_review_comment"
    ) {
      return "pull_request";
    }
    throw new Error(SOURCE_WEBHOOK_RECONCILE_ERROR_MESSAGE);
  }

  private toPositiveInteger(value: string | number): number {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new Error(SOURCE_WEBHOOK_RECONCILE_ERROR_MESSAGE);
    }
    return parsed;
  }

  private toIsoString(value: Date | string): string {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) {
      throw new Error(SOURCE_WEBHOOK_RECONCILE_ERROR_MESSAGE);
    }
    return date.toISOString();
  }
}
