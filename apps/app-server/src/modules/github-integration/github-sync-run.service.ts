import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest, notFound } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import { ListGithubSyncRunsQuery, StartGithubSyncRunRequest } from "./dto";
import { GithubIntegrationConfigService } from "./github-integration-config.service";
import { GithubSyncJobService } from "./github-sync-job.service";
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
import type {
  GithubPaginatedPayload,
  GithubSyncRunDetailPayload,
  GithubSyncRunPayload,
  GithubSyncStatus,
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

@Injectable()
export class GithubSyncRunService {
  constructor(
    private readonly database: DatabaseService,
    private readonly configService: GithubIntegrationConfigService,
    private readonly workspaceService: WorkspaceService,
    private readonly syncExecutorService: GithubSyncExecutorService,
    private readonly projectV2SyncTokenService: GithubProjectV2SyncTokenService,
    private readonly syncJobService?: GithubSyncJobService
  ) {}

  async startGithubSyncRun(
    currentUserId: string,
    workspaceId: string,
    input: StartGithubSyncRunRequest | undefined
  ): Promise<GithubSyncRunPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

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

    const syncRun = await this.createGithubSyncRun({
      workspaceId,
      installationId,
      repositoryId,
      projectV2Id,
      target
    });

    if (this.syncJobService) {
      await this.syncJobService.enqueueSyncJob(syncRun.id, currentUserId);
      return this.mapGithubSyncRun(syncRun);
    }

    // Direct unit tests construct this service without Nest's queue provider. Production
    // always supplies the job service above; retain the executor path for those isolated tests.
    try {
      const githubUserAccessToken = await this.projectV2SyncTokenService.resolvePersonalProjectV2UserAccessToken({
        currentUserId, installation, requiresProjectV2Access: this.requiresProjectV2Access(target)
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
      projectV2Id
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

  private async createGithubSyncRun(input: {
    workspaceId: string;
    installationId: string;
    repositoryId: string | null;
    projectV2Id: string | null;
    target: GithubSyncTarget;
  }): Promise<GithubSyncRunRow> {
    const row = await this.database.queryOne<GithubSyncRunRow>(
      `
        INSERT INTO github_sync_runs (
          workspace_id,
          installation_id,
          repository_id,
          project_v2_id,
          target,
          status
        )
        VALUES ($1, $2, $3, $4, $5, 'queued')
        RETURNING
          id,
          workspace_id,
          installation_id,
          repository_id,
          project_v2_id,
          target,
          status,
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
        input.target
      ]
    );

    if (!row) {
      throw badRequest("GitHub sync run could not be created");
    }

    return row;
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
          full_name
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
    projectV2Id: string | null
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
