import { Injectable, Optional } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest, conflict, notFound } from "../../common/api-error";
import { DatabaseService, type DatabaseTransaction } from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import { ListGithubSyncRunsQuery, StartGithubSyncRunRequest } from "./dto";
import { GithubIntegrationConfigService } from "./github-integration-config.service";
import { GithubSyncJobService } from "./github-sync-job.service";
import {
  fingerprintGithubManualSyncScope,
  hashGithubManualSyncIdempotencyKey,
  readGithubManualSyncIdempotencyKey
} from "./github-manual-sync-admission";
import {
  GithubManualSyncIdempotencyConflictError,
  GithubManualSyncQueueSaturatedError,
  GithubManualSyncRateLimitedError
} from "./github-manual-sync-error";
import { GithubSyncObservabilityService } from "./github-sync-observability.service";
import { serializeGithubJsonb } from "./github-jsonb";
import {
  createGithubSyncProgressCursor,
  readGithubSyncProgress
} from "./github-sync-progress";
import {
  GithubSyncExecutorService,
  type GithubSyncInstallationRow,
  type GithubSyncProjectV2ContextRow,
  type GithubSyncRepositoryContextRow,
  type GithubSyncRunProgress,
  type GithubSyncRunSummary,
} from "./github-sync-executor.service";
import { GithubProjectV2SyncTokenService } from "./github-project-v2-sync-token.service";
import { readGithubRepositoryOwnerType } from "./github-repository-owner";
import type {
  GithubPaginatedPayload,
  GithubSyncRunDetailPayload,
  GithubSyncRunPayload,
  GithubSyncStatus,
  GithubSyncTriggerSource,
  GithubSyncTarget
} from "./types";

interface GithubSyncRunRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  installation_id: string | null;
  repository_id: string | null;
  project_v2_id: string | null;
  target: GithubSyncTarget;
  status: GithubSyncStatus;
  trigger_source: GithubSyncTriggerSource;
  started_at: Date | string;
  finished_at: Date | string | null;
  fetched_count: string | number;
  created_count: string | number;
  updated_count: string | number;
  skipped_count: string | number;
  error_message: string | null;
  cursor: unknown;
}

interface CountRow extends QueryResultRow {
  total: string | number;
}

interface PaginationInput {
  page?: unknown;
  limit?: unknown;
}

interface NormalizedPagination {
  page: number;
  limit: number;
  offset: number;
}

const MAX_PAGE_LIMIT = 100;
const GITHUB_SYNC_TARGETS: readonly GithubSyncTarget[] = [
  "source",
  "repositories",
  "issues",
  "pull_requests",
  "project_v2",
  "project_v2_fields",
  "project_v2_items",
  "full"
];
const GITHUB_SYNC_STATUSES: readonly GithubSyncStatus[] = [
  "queued",
  "running",
  "success",
  "failed"
];
const GITHUB_SYNC_TRIGGER_SOURCES: readonly GithubSyncTriggerSource[] = [
  "manual",
  "automatic",
  "legacy"
];

@Injectable()
export class GithubSyncRunService {
  constructor(
    private readonly database: DatabaseService,
    private readonly configService: GithubIntegrationConfigService,
    private readonly workspaceService: WorkspaceService,
    private readonly syncExecutorService: GithubSyncExecutorService,
    private readonly projectV2SyncTokenService: GithubProjectV2SyncTokenService,
    private readonly syncJobService?: GithubSyncJobService,
    @Optional() private readonly observability?: GithubSyncObservabilityService
  ) {}

  async startGithubSyncRun(
    currentUserId: string,
    workspaceId: string,
    input: StartGithubSyncRunRequest | undefined,
    triggerSource: Exclude<GithubSyncTriggerSource, "legacy">,
    idempotencyKey?: unknown
  ): Promise<GithubSyncRunPayload> {
    if (triggerSource === "manual") {
      await this.workspaceService.assertWorkspaceOwnerAccess(currentUserId, workspaceId);
    } else {
      await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    }

    const target = this.readGithubSyncTarget(input?.target, "target");
    const installationId = this.validateRequiredString(
      input?.installationId,
      "GitHub installation id is required"
    );
    const repositoryId = this.readOptionalStringId(
      input?.repositoryId,
      "repositoryId"
    );
    const projectV2Id = this.readOptionalStringId(input?.projectV2Id, "projectV2Id");

    this.assertGithubSyncScope(target, projectV2Id);

    const installation = await this.findGithubSyncInstallation(
      workspaceId,
      installationId
    );
    if (!installation) {
      throw notFound("GitHub App installation not found");
    }

    const repository = repositoryId
      ? await this.findGithubSyncRepository(workspaceId, repositoryId)
      : null;
    if (repositoryId && !repository) {
      throw notFound("GitHub repository not found");
    }
    if (repository && repository.installation_id !== installation.id) {
      throw badRequest("GitHub repository does not belong to the installation");
    }

    const projectV2 = projectV2Id
      ? await this.findGithubSyncProjectV2(workspaceId, projectV2Id)
      : null;
    if (projectV2Id && !projectV2) {
      throw notFound("GitHub ProjectV2 not found");
    }
    if (projectV2 && projectV2.installation_id !== installation.id) {
      throw badRequest("GitHub ProjectV2 does not belong to the installation");
    }

    const createInput = {
      workspaceId,
      installationId,
      repositoryId,
      projectV2Id,
      target,
      triggerSource
    };
    const admission = triggerSource === "manual"
      ? await this.admitManualGithubSyncRun(createInput, currentUserId, idempotencyKey)
      : { syncRun: await this.createGithubSyncRun(createInput), reused: false, preparedJob: null };
    const { syncRun, reused } = admission;

    if (reused) {
      return this.mapGithubSyncRun(syncRun);
    }

    if (admission.preparedJob && this.syncJobService) {
      await this.syncJobService.publishPreparedSyncJob(admission.preparedJob);
      return this.mapGithubSyncRun(syncRun);
    }

    if (this.syncJobService) {
      await this.syncJobService.enqueueSyncJob(syncRun.id, currentUserId);
      return this.mapGithubSyncRun(syncRun);
    }

    // Direct unit tests construct this service without Nest's queue provider. Production
    // always supplies the job service above; retain the executor path for those isolated tests.
    try {
      const githubUserAccessToken = await this.projectV2SyncTokenService.resolvePersonalProjectV2UserAccessToken({
        currentUserId,
        installation,
        repositoryOwnerLogin: repository?.owner_login ?? null,
        repositoryOwnerType: readGithubRepositoryOwnerType(repository?.raw),
        requiresProjectV2Access: this.requiresProjectV2Access(target)
      });
      const summary = await this.syncExecutorService.runGithubSyncTarget(target, {
        currentUserId, workspaceId, installation, repository, projectV2, githubUserAccessToken,
        config: this.configService.getGithubAppConfig(),
        reportProgress: (progress) => this.updateGithubSyncRunProgress(syncRun.id, progress)
      });
      return this.mapGithubSyncRun(await this.completeGithubSyncRunSuccess(syncRun.id, summary));
    } catch (error) {
      return this.mapGithubSyncRun(await this.completeGithubSyncRunFailure(syncRun.id, this.getGithubSyncErrorMessage(error)));
    }
  }

  async listGithubSyncRuns(
    currentUserId: string,
    workspaceId: string,
    query: ListGithubSyncRunsQuery
  ): Promise<GithubPaginatedPayload<GithubSyncRunPayload>> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const pagination = this.normalizePagination(query, 20);
    const target = this.readOptionalGithubSyncTarget(query.target, "target");
    const status = this.readOptionalGithubSyncStatus(query.status, "status");
    const triggerSource = this.readOptionalGithubSyncTriggerSource(
      query.triggerSource,
      "triggerSource"
    );
    const repositoryId = this.readOptionalStringId(
      query.repositoryId,
      "repositoryId"
    );
    const projectV2Id = this.readOptionalStringId(query.projectV2Id, "projectV2Id");
    const { whereSql, values } = this.buildGithubSyncRunFilters(
      workspaceId,
      target,
      status,
      repositoryId,
      projectV2Id,
      triggerSource
    );
    const count = await this.countRows(
      `SELECT COUNT(*)::int AS total FROM github_sync_runs WHERE ${whereSql}`,
      values
    );
    const rows = await this.database.query<GithubSyncRunRow>(
      `
        ${this.githubSyncRunSelectSql()}
        WHERE ${whereSql}
        ORDER BY started_at DESC NULLS LAST, created_at DESC, id DESC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}
      `,
      [...values, pagination.limit, pagination.offset]
    );

    return {
      data: rows.map((row) => this.mapGithubSyncRun(row)),
      meta: {
        page: pagination.page,
        limit: pagination.limit,
        total: count
      }
    };
  }

  async getGithubSyncRun(
    currentUserId: string,
    workspaceId: string,
    syncRunId: string
  ): Promise<GithubSyncRunDetailPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const row = await this.database.queryOne<GithubSyncRunRow>(
      `
        ${this.githubSyncRunSelectSql()}
        WHERE workspace_id = $1
          AND id = $2
      `,
      [workspaceId, syncRunId]
    );
    if (!row) {
      throw notFound("GitHub sync run not found");
    }

    return this.mapGithubSyncRunDetail(row);
  }

  private mapGithubSyncRun(row: GithubSyncRunRow): GithubSyncRunPayload {
    const startedAt = this.toNullableIsoString(row.started_at);
    if (!startedAt) {
      throw badRequest("Invalid GitHub sync start time");
    }
    const progress = readGithubSyncProgress(row.status, row.cursor);

    return {
      id: row.id,
      target: row.target,
      status: row.status,
      triggerSource: row.trigger_source,
      installationId: row.installation_id,
      repositoryId: row.repository_id,
      projectV2Id: row.project_v2_id,
      startedAt,
      finishedAt: this.toNullableIsoString(row.finished_at),
      fetchedCount: this.toInteger(row.fetched_count, "Invalid GitHub sync fetched count"),
      createdCount: this.toInteger(row.created_count, "Invalid GitHub sync created count"),
      updatedCount: this.toInteger(row.updated_count, "Invalid GitHub sync updated count"),
      skippedCount: this.toInteger(row.skipped_count, "Invalid GitHub sync skipped count"),
      ...progress,
      errorMessage: row.error_message
    };
  }

  private mapGithubSyncRunDetail(
    row: GithubSyncRunRow
  ): GithubSyncRunDetailPayload {
    return {
      ...this.mapGithubSyncRun(row),
      cursor: this.toRecord(row.cursor)
    };
  }

  private async createOrReuseManualGithubSyncRun(input: {
    workspaceId: string;
    installationId: string;
    repositoryId: string | null;
    projectV2Id: string | null;
    target: GithubSyncTarget;
    triggerSource: Exclude<GithubSyncTriggerSource, "legacy">;
  }): Promise<{ syncRun: GithubSyncRunRow; reused: boolean; preparedJob: null }> {
    const run = async (transaction: DatabaseTransaction) => {
      await transaction.execute(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`github-manual-sync:${input.workspaceId}`]
      );
      const activeRuns = await this.findActiveManualGithubSyncRuns(input.workspaceId, transaction);
      if (activeRuns.length > 0) {
        if (activeRuns.every((activeRun) => activeRun.installation_id === input.installationId && activeRun.repository_id === input.repositoryId && activeRun.project_v2_id === input.projectV2Id && activeRun.target === input.target)) {
          return { syncRun: activeRuns[0], reused: true, preparedJob: null };
        }
        throw conflict("A different GitHub manual sync is already active");
      }
      return { syncRun: await this.createGithubSyncRun(input, transaction), reused: false, preparedJob: null };
    };
    const databaseWithTransaction = this.database as unknown as {
      transaction?: (callback: (transaction: DatabaseTransaction) => Promise<{ syncRun: GithubSyncRunRow; reused: boolean; preparedJob: null }>) => Promise<{ syncRun: GithubSyncRunRow; reused: boolean; preparedJob: null }>;
    };
    if (databaseWithTransaction.transaction) {
      return databaseWithTransaction.transaction(run);
    }
    return { syncRun: await this.createGithubSyncRun(input), reused: false, preparedJob: null };
  }

  private async admitManualGithubSyncRun(
    input: {
      workspaceId: string;
      installationId: string;
      repositoryId: string | null;
      projectV2Id: string | null;
      target: GithubSyncTarget;
      triggerSource: Exclude<GithubSyncTriggerSource, "legacy">;
    },
    requestedByUserId: string,
    idempotencyKey: unknown
  ): Promise<{ syncRun: GithubSyncRunRow; reused: boolean; preparedJob: import("./github-sync-job.service").PreparedGithubSyncJob | null }> {
    if (!this.syncJobService) return this.createOrReuseManualGithubSyncRun(input);
    const syncJobService = this.syncJobService;
    const keyHash = hashGithubManualSyncIdempotencyKey(readGithubManualSyncIdempotencyKey(idempotencyKey));
    const scopeFingerprint = fingerprintGithubManualSyncScope(input);
    const config = this.configService.getGithubManualSyncAdmissionConfig();
    return this.database.transaction(async (transaction) => {
      await transaction.execute("SELECT pg_advisory_xact_lock(hashtextextended('github-manual-sync:global-admission', 0))");
      await transaction.execute("SELECT pg_advisory_xact_lock(hashtextextended('github-manual-sync:workspace:' || $1, 0))", [input.workspaceId]);

      const replay = await transaction.queryOne<GithubSyncRunRow & { scope_fingerprint: string }>(`
        SELECT request.scope_fingerprint, run.id, run.workspace_id, run.installation_id, run.repository_id,
          run.project_v2_id, run.target, run.status, run.trigger_source, run.started_at, run.finished_at,
          run.fetched_count, run.created_count, run.updated_count, run.skipped_count, run.error_message, run.cursor
        FROM github_sync_manual_requests AS request
        INNER JOIN github_sync_runs AS run ON run.id=request.sync_run_id AND run.workspace_id=request.workspace_id
        WHERE request.workspace_id=$1 AND request.requested_by_user_id=$2 AND request.idempotency_key_hash=$3`,
        [input.workspaceId, requestedByUserId, keyHash]);
      if (replay) {
        if (replay.scope_fingerprint !== scopeFingerprint) throw new GithubManualSyncIdempotencyConflictError();
        this.observability?.emitManualSyncIdempotencyReplay();
        return { syncRun: replay, reused: true, preparedJob: null };
      }

      const activeRuns = await this.findActiveManualGithubSyncRuns(input.workspaceId, transaction);
      if (activeRuns.length > 0) {
        const compatible = activeRuns.every((run) => run.installation_id === input.installationId && run.repository_id === input.repositoryId && run.project_v2_id === input.projectV2Id && run.target === input.target);
        if (!compatible) throw conflict("A different GitHub manual sync is already active");
        const activeRun = activeRuns[0];
        await this.insertManualRequestLedger(transaction, input.workspaceId, requestedByUserId, keyHash, scopeFingerprint, activeRun.id);
        this.observability?.emitManualSyncActiveRunReuse();
        return { syncRun: activeRun, reused: true, preparedJob: null };
      }

      const userLimit = await this.manualLimit(transaction, "user", input.workspaceId, requestedByUserId, config.rateWindowSeconds, config.cooldownSeconds);
      if (userLimit.total >= config.userLimit || userLimit.cooldownRetryAfterSeconds) {
        const retryAfterSeconds = userLimit.cooldownRetryAfterSeconds ?? userLimit.windowRetryAfterSeconds;
        this.observability?.emitManualSyncAdmissionRejected("user", retryAfterSeconds);
        throw new GithubManualSyncRateLimitedError("user", retryAfterSeconds);
      }
      const workspaceLimit = await this.manualLimit(transaction, "workspace", input.workspaceId, requestedByUserId, config.rateWindowSeconds, config.cooldownSeconds);
      if (workspaceLimit.total >= config.workspaceLimit || workspaceLimit.cooldownRetryAfterSeconds) {
        const retryAfterSeconds = workspaceLimit.cooldownRetryAfterSeconds ?? workspaceLimit.windowRetryAfterSeconds;
        this.observability?.emitManualSyncAdmissionRejected("workspace", retryAfterSeconds);
        throw new GithubManualSyncRateLimitedError("workspace", retryAfterSeconds);
      }
      const queued = await transaction.queryOne<{ total: string | number; retry_after_seconds: string | number }>(`
        SELECT COUNT(*)::int AS total,
          GREATEST(1, COALESCE(CEIL(EXTRACT(EPOCH FROM (MIN(job.created_at) + ($1 * interval '1 second') - now()))), 1))::int AS retry_after_seconds
        FROM github_sync_jobs AS job
        INNER JOIN github_sync_runs AS run ON run.id=job.sync_run_id
        WHERE run.trigger_source='manual' AND job.status='queued'`, [config.cooldownSeconds]);
      if (this.toInteger(queued?.total ?? 0, "Invalid queued job count") >= config.maxQueuedJobs) {
        const retryAfterSeconds = this.toInteger(queued?.retry_after_seconds ?? 1, "Invalid queue retry delay");
        this.observability?.emitManualSyncQueueSaturated(retryAfterSeconds);
        throw new GithubManualSyncQueueSaturatedError(retryAfterSeconds);
      }
      const syncRun = await this.createGithubSyncRun(input, transaction);
      const preparedJob = await syncJobService.prepareSyncJob(transaction, syncRun.id, requestedByUserId);
      if (!preparedJob) throw badRequest("GitHub sync job could not be created");
      await this.insertManualRequestLedger(transaction, input.workspaceId, requestedByUserId, keyHash, scopeFingerprint, syncRun.id);
      return { syncRun, reused: false, preparedJob };
    });
  }

  private async insertManualRequestLedger(transaction: DatabaseTransaction, workspaceId: string, userId: string, keyHash: string, scopeFingerprint: string, syncRunId: string): Promise<void> {
    await transaction.execute(`INSERT INTO github_sync_manual_requests
      (workspace_id, requested_by_user_id, idempotency_key_hash, scope_fingerprint, sync_run_id)
      VALUES ($1, $2, $3, $4, $5)`, [workspaceId, userId, keyHash, scopeFingerprint, syncRunId]);
  }

  private async manualLimit(transaction: DatabaseTransaction, scope: "user" | "workspace", workspaceId: string, userId: string, windowSeconds: number, cooldownSeconds: number): Promise<{ total: number; windowRetryAfterSeconds: number; cooldownRetryAfterSeconds: number | null }> {
    const userFilter = scope === "user" ? "AND job.requested_by_user_id=$2" : "";
    const row = await transaction.queryOne<{ total: string | number; window_retry_after_seconds: string | number; cooldown_retry_after_seconds: string | number | null }>(`
      SELECT COUNT(*)::int AS total,
        GREATEST(1, COALESCE(CEIL(EXTRACT(EPOCH FROM (MIN(run.created_at) + ($3 * interval '1 second') - now()))), 1))::int AS window_retry_after_seconds,
        MAX(GREATEST(1, CEIL(EXTRACT(EPOCH FROM (run.created_at + ($4 * interval '1 second') - now()))))::int) AS cooldown_retry_after_seconds
      FROM github_sync_runs AS run
      INNER JOIN github_sync_jobs AS job ON job.sync_run_id=run.id
      WHERE run.workspace_id=$1 AND run.trigger_source='manual' ${userFilter}
        AND run.created_at >= now() - ($3 * interval '1 second')`,
      [workspaceId, userId, windowSeconds, cooldownSeconds]);
    return {
      total: this.toInteger(row?.total ?? 0, "Invalid manual sync count"),
      windowRetryAfterSeconds: this.toInteger(row?.window_retry_after_seconds ?? 1, "Invalid manual sync retry delay"),
      cooldownRetryAfterSeconds: row?.cooldown_retry_after_seconds === null || row?.cooldown_retry_after_seconds === undefined ? null : this.toInteger(row.cooldown_retry_after_seconds, "Invalid manual sync cooldown")
    };
  }

  private async createGithubSyncRun(input: {
    workspaceId: string;
    installationId: string;
    repositoryId: string | null;
    projectV2Id: string | null;
    target: GithubSyncTarget;
    triggerSource: Exclude<GithubSyncTriggerSource, "legacy">;
  }, database: Pick<DatabaseService, "queryOne"> | DatabaseTransaction = this.database): Promise<GithubSyncRunRow> {
    const row = await database.queryOne<GithubSyncRunRow>(
      `
        INSERT INTO github_sync_runs (
          workspace_id,
          installation_id,
          repository_id,
          project_v2_id,
          target,
          status,
          trigger_source
        )
        VALUES ($1, $2, $3, $4, $5, 'queued', $6)
        RETURNING
          id,
          workspace_id,
          installation_id,
          repository_id,
          project_v2_id,
          target,
          status,
          trigger_source,
          started_at,
          finished_at,
          fetched_count,
          created_count,
          updated_count,
          skipped_count,
          error_message,
          cursor
      `,
      [
        input.workspaceId,
        input.installationId,
        input.repositoryId,
        input.projectV2Id,
        input.target,
        input.triggerSource
      ]
    );

    if (!row) {
      throw badRequest("GitHub sync run could not be created");
    }

    return row;
  }

  private async findActiveManualGithubSyncRuns(
    workspaceId: string,
    database: Pick<DatabaseService, "query"> | DatabaseTransaction = this.database
  ): Promise<GithubSyncRunRow[]> {
    return database.query<GithubSyncRunRow>(
      `
        ${this.githubSyncRunSelectSql()}
        WHERE workspace_id = $1
          AND trigger_source = 'manual'
          AND status IN ('queued', 'running')
        ORDER BY started_at DESC NULLS LAST, created_at DESC, id DESC
      `,
      [workspaceId]
    );
  }

  private async updateGithubSyncRunProgress(
    syncRunId: string,
    progress: GithubSyncRunProgress
  ): Promise<void> {
    await this.database.execute(
      `
        UPDATE github_sync_runs
        SET
          fetched_count = $2,
          created_count = $3,
          updated_count = $4,
          skipped_count = $5,
          cursor = jsonb_set(cursor, '{progress}', $6::jsonb, true)
        WHERE id = $1
          AND status = 'running'
      `,
      [
        syncRunId,
        progress.summary.fetchedCount,
        progress.summary.createdCount,
        progress.summary.updatedCount,
        progress.summary.skippedCount,
        serializeGithubJsonb(
          createGithubSyncProgressCursor(
            progress.progressPercent,
            progress.progressStage
          )
        )
      ]
    );
  }

  private async completeGithubSyncRunSuccess(
    syncRunId: string,
    summary: GithubSyncRunSummary
  ): Promise<GithubSyncRunRow> {
    const row = await this.database.queryOne<GithubSyncRunRow>(
      `
        UPDATE github_sync_runs
        SET
          status = 'success',
          finished_at = now(),
          fetched_count = $2,
          created_count = $3,
          updated_count = $4,
          skipped_count = $5,
          error_message = NULL,
          cursor = $6::jsonb
        WHERE id = $1
        RETURNING
          id,
          workspace_id,
          installation_id,
          repository_id,
          project_v2_id,
          target,
          status,
          trigger_source,
          started_at,
          finished_at,
          fetched_count,
          created_count,
          updated_count,
          skipped_count,
          error_message,
          cursor
      `,
      [
        syncRunId,
        summary.fetchedCount,
        summary.createdCount,
        summary.updatedCount,
        summary.skippedCount,
        serializeGithubJsonb(summary.cursor)
      ]
    );

    if (!row) {
      throw badRequest("GitHub sync run could not be completed");
    }

    return row;
  }

  private async completeGithubSyncRunFailure(
    syncRunId: string,
    errorMessage: string
  ): Promise<GithubSyncRunRow> {
    const row = await this.database.queryOne<GithubSyncRunRow>(
      `
        UPDATE github_sync_runs
        SET
          status = 'failed',
          finished_at = now(),
          error_message = $2
        WHERE id = $1
        RETURNING
          id,
          workspace_id,
          installation_id,
          repository_id,
          project_v2_id,
          target,
          status,
          trigger_source,
          started_at,
          finished_at,
          fetched_count,
          created_count,
          updated_count,
          skipped_count,
          error_message,
          cursor
      `,
      [syncRunId, errorMessage]
    );

    if (!row) {
      throw badRequest("GitHub sync run could not be marked failed");
    }

    return row;
  }

  private getGithubSyncErrorMessage(error: unknown): string {
    const fallback = "GitHub sync failed";
    let message: string | null = null;

    if (typeof error === "object" && error !== null) {
      const response = (error as { getResponse?: () => unknown }).getResponse?.();
      const responseMessage =
        typeof response === "object" && response !== null
          ? (response as { error?: { message?: unknown } }).error?.message
          : null;
      if (typeof responseMessage === "string" && responseMessage.trim()) {
        message = responseMessage;
      }
    }

    if (!message && error instanceof Error && error.message) {
      message = error.message;
    }

    return (message ?? fallback).slice(0, 1000);
  }

  private async findGithubSyncInstallation(
    workspaceId: string,
    installationId: string
  ): Promise<GithubSyncInstallationRow | null> {
    return this.database.queryOne<GithubSyncInstallationRow>(
      `
        SELECT
          id,
          workspace_id,
          github_installation_id,
          account_login,
          account_type
        FROM github_installations
        WHERE workspace_id = $1
          AND id = $2
      `,
      [workspaceId, installationId]
    );
  }

  private requiresProjectV2Access(target: GithubSyncTarget): boolean {
    return (
      target === "full" ||
      target === "project_v2" ||
      target === "project_v2_fields" ||
      target === "project_v2_items"
    );
  }

  private async findGithubSyncRepository(
    workspaceId: string,
    repositoryId: string
  ): Promise<GithubSyncRepositoryContextRow | null> {
    return this.database.queryOne<GithubSyncRepositoryContextRow>(
      `
        SELECT
          id,
          workspace_id,
          installation_id,
          github_node_id,
          owner_login,
          name,
          full_name,
          raw
        FROM github_repositories
        WHERE workspace_id = $1
          AND id = $2
      `,
      [workspaceId, repositoryId]
    );
  }

  private async findGithubSyncProjectV2(
    workspaceId: string,
    projectV2Id: string
  ): Promise<GithubSyncProjectV2ContextRow | null> {
    return this.database.queryOne<GithubSyncProjectV2ContextRow>(
      `
        SELECT
          id,
          workspace_id,
          installation_id,
          github_project_node_id
        FROM github_projects_v2
        WHERE workspace_id = $1
          AND id = $2
      `,
      [workspaceId, projectV2Id]
    );
  }

  private async countRows(
    text: string,
    values: readonly unknown[]
  ): Promise<number> {
    const row = await this.database.queryOne<CountRow>(text, values);
    return row ? this.toInteger(row.total, "Invalid row count") : 0;
  }

  private buildGithubSyncRunFilters(
    workspaceId: string,
    target: GithubSyncTarget | null,
    status: GithubSyncStatus | null,
    repositoryId: string | null,
    projectV2Id: string | null,
    triggerSource: GithubSyncTriggerSource | null
  ): { whereSql: string; values: unknown[] } {
    const values: unknown[] = [workspaceId];
    const filters = ["workspace_id = $1"];

    if (target) {
      values.push(target);
      filters.push(`target = $${values.length}`);
    }

    if (status) {
      values.push(status);
      filters.push(`status = $${values.length}`);
    }

    if (repositoryId) {
      values.push(repositoryId);
      filters.push(`repository_id = $${values.length}`);
    }

    if (projectV2Id) {
      values.push(projectV2Id);
      filters.push(`project_v2_id = $${values.length}`);
    }

    if (triggerSource) {
      values.push(triggerSource);
      filters.push(`trigger_source = $${values.length}`);
    }

    return {
      whereSql: filters.join(" AND "),
      values
    };
  }

  private githubSyncRunSelectSql(): string {
    return `
      SELECT
        id,
        workspace_id,
        installation_id,
        repository_id,
        project_v2_id,
        target,
        status,
        trigger_source,
        started_at,
        finished_at,
        fetched_count,
        created_count,
        updated_count,
        skipped_count,
        error_message,
        cursor
      FROM github_sync_runs
    `;
  }

  private normalizePagination(
    input: PaginationInput,
    defaultLimit: number
  ): NormalizedPagination {
    const page = this.readPositiveInteger(input.page, "page", 1);
    const limit = this.readPositiveInteger(input.limit, "limit", defaultLimit);

    if (limit > MAX_PAGE_LIMIT) {
      throw badRequest(`limit must be ${MAX_PAGE_LIMIT} or less`);
    }

    return {
      page,
      limit,
      offset: (page - 1) * limit
    };
  }

  private readPositiveInteger(
    value: unknown,
    field: string,
    defaultValue: number
  ): number {
    if (value === undefined || value === null || value === "") {
      return defaultValue;
    }

    if (Array.isArray(value)) {
      throw badRequest(`${field} must be a positive integer`);
    }

    const raw = typeof value === "number" ? String(value) : value;
    if (typeof raw !== "string" || !/^\d+$/.test(raw.trim())) {
      throw badRequest(`${field} must be a positive integer`);
    }

    const parsed = Number(raw.trim());
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw badRequest(`${field} must be a positive integer`);
    }

    return parsed;
  }

  private readGithubSyncTarget(value: unknown, field: string): GithubSyncTarget {
    if (Array.isArray(value) || typeof value !== "string" || !value.trim()) {
      throw badRequest(`${field} must be one of ${GITHUB_SYNC_TARGETS.join(", ")}`);
    }

    const target = value.trim();
    if (this.isGithubSyncTarget(target)) {
      return target;
    }

    throw badRequest(`${field} must be one of ${GITHUB_SYNC_TARGETS.join(", ")}`);
  }

  private readOptionalGithubSyncTarget(
    value: unknown,
    field: string
  ): GithubSyncTarget | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    return this.readGithubSyncTarget(value, field);
  }

  private readOptionalGithubSyncStatus(
    value: unknown,
    field: string
  ): GithubSyncStatus | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    if (Array.isArray(value) || typeof value !== "string" || !value.trim()) {
      throw badRequest(`${field} must be one of ${GITHUB_SYNC_STATUSES.join(", ")}`);
    }

    const status = value.trim();
    if (this.isGithubSyncStatus(status)) {
      return status;
    }

    throw badRequest(`${field} must be one of ${GITHUB_SYNC_STATUSES.join(", ")}`);
  }

  private readOptionalGithubSyncTriggerSource(
    value: unknown,
    field: string
  ): GithubSyncTriggerSource | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    if (Array.isArray(value) || typeof value !== "string" || !value.trim()) {
      throw badRequest(
        `${field} must be one of ${GITHUB_SYNC_TRIGGER_SOURCES.join(", ")}`
      );
    }

    const triggerSource = value.trim();
    if (this.isGithubSyncTriggerSource(triggerSource)) {
      return triggerSource;
    }

    throw badRequest(
      `${field} must be one of ${GITHUB_SYNC_TRIGGER_SOURCES.join(", ")}`
    );
  }

  private readOptionalStringId(value: unknown, field: string): string | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    if (Array.isArray(value) || typeof value !== "string") {
      throw badRequest(`${field} must be a string`);
    }

    const id = value.trim();
    return id ? id : null;
  }

  private assertGithubSyncScope(
    target: GithubSyncTarget,
    projectV2Id: string | null
  ): void {
    if (target === "full" && projectV2Id) {
      throw badRequest("projectV2Id is not allowed for full sync");
    }

    if (
      (target === "project_v2" ||
        target === "project_v2_fields" ||
        target === "project_v2_items") &&
      !projectV2Id
    ) {
      throw badRequest("projectV2Id is required for this sync target");
    }
  }

  private isGithubSyncTarget(value: string): value is GithubSyncTarget {
    return GITHUB_SYNC_TARGETS.includes(value as GithubSyncTarget);
  }

  private isGithubSyncStatus(value: string): value is GithubSyncStatus {
    return GITHUB_SYNC_STATUSES.includes(value as GithubSyncStatus);
  }

  private isGithubSyncTriggerSource(
    value: string
  ): value is GithubSyncTriggerSource {
    return GITHUB_SYNC_TRIGGER_SOURCES.includes(
      value as GithubSyncTriggerSource
    );
  }

  private validateRequiredString(value: unknown, message: string): string {
    if (Array.isArray(value)) {
      throw badRequest(message);
    }

    if (typeof value !== "string" || !value.trim()) {
      throw badRequest(message);
    }

    return value.trim();
  }

  private toInteger(value: string | number, message: string): number {
    const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
    if (!Number.isSafeInteger(parsed)) {
      throw badRequest(message);
    }

    return parsed;
  }

  private toNullableIsoString(value: Date | string | null): string | null {
    if (!value) {
      return null;
    }

    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  private toRecord(value: unknown): Record<string, unknown> {
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value) as unknown;
        return this.toRecord(parsed);
      } catch {
        return {};
      }
    }

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    return {};
  }
}
