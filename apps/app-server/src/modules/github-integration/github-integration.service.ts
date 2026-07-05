import { Injectable, Optional } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { QueryResultRow } from "pg";
import { badRequest, notFound } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import {
  GithubAppClient,
  type GithubInstallationRepositoryApiItem,
  type GithubIssueApiItem,
  type GithubPullRequestApiItem
} from "./github-app.client";
import { GithubAppInstallationService } from "./github-app-installation.service";
import { GithubAppInstallationStateService } from "./github-app-installation-state.service";
import {
  type GithubAppRuntimeConfig,
  GithubIntegrationConfigService
} from "./github-integration-config.service";
import { GithubOAuthClient } from "./github-oauth.client";
import { GithubOAuthIntegrationService } from "./github-oauth-integration.service";
import { GithubOAuthStateService } from "./github-oauth-state.service";
import { GithubProjectV2Service } from "./github-project-v2.service";
import { GithubPullRequestRemoteService } from "./github-pull-request-remote.service";
import { GithubSourceReadService } from "./github-source-read.service";
import { GithubTokenEncryptionService } from "./github-token-encryption.service";
import type {
  GithubAppInstallationCallbackQuery,
  GithubWebhookRequest,
  GithubOAuthCallbackQuery,
  ListGithubSyncRunsQuery,
  ListGithubPullRequestFilesQuery,
  ListGithubPullRequestsQuery,
  ListGithubProjectsV2Query,
  ListGithubRepositoriesQuery,
  StartGithubAppInstallationRequest,
  StartGithubSyncRunRequest,
  StartGithubOAuthRequest
} from "./dto";
import type {
  GitHubIntegrationModuleInfo,
  GithubAppInstallationCallbackPayload,
  GithubAppInstallationPayload,
  GithubAppInstallationStartPayload,
  GithubIssuePayload,
  GithubOAuthCallbackPayload,
  GithubOAuthDisconnectPayload,
  GithubOAuthStartPayload,
  GithubOAuthStatusPayload,
  GithubPaginatedPayload,
  GithubProjectV2DetailPayload,
  GithubProjectV2FieldPayload,
  GithubProjectV2ItemPayload,
  GithubProjectV2KanbanPayload,
  GithubProjectV2ListItemPayload,
  GithubProjectV2StatusOptionPayload,
  GithubPullRequestConflictStatusPayload,
  GithubPullRequestDetailPayload,
  GithubPullRequestFilePayload,
  GithubPullRequestListItemPayload,
  GithubWebhookDeliveryPayload,
  GithubWebhookDeliveryStatus,
  GithubRepositoryDetailPayload,
  GithubRepositoryListItemPayload,
  GithubSyncRunDetailPayload,
  GithubSyncRunPayload,
  GithubSyncStatus,
  GithubSyncTarget
} from "./types";

interface GithubSyncInstallationRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  github_installation_id: string | number;
}

interface GithubSyncRepositoryContextRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  installation_id: string | null;
  owner_login: string;
  name: string;
  full_name: string;
}

interface GithubSyncProjectV2ContextRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  installation_id: string;
}

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

interface GithubSyncUpsertResultRow extends QueryResultRow {
  id: string;
  created: boolean;
}

interface GithubWebhookDeliveryRow extends QueryResultRow {
  delivery_id: string;
  event_name: string;
  status: "received" | "processed" | "failed" | "ignored";
  received_at: Date | string;
  processed_at: Date | string | null;
  error_message: string | null;
}

interface CountRow extends QueryResultRow {
  total: string | number;
}

interface GithubSyncRunSummary {
  fetchedCount: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  cursor: Record<string, unknown>;
}

interface GithubSyncRunContext {
  currentUserId: string;
  workspaceId: string;
  installation: GithubSyncInstallationRow;
  repository: GithubSyncRepositoryContextRow | null;
  projectV2: GithubSyncProjectV2ContextRow | null;
  config: GithubAppRuntimeConfig;
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
  "running",
  "success",
  "failed"
];
const SUPPORTED_GITHUB_WEBHOOK_EVENTS = new Set([
  "ping",
  "installation",
  "installation_repositories",
  "repository",
  "issues",
  "issue_comment",
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
  "projects_v2",
  "projects_v2_item",
  "projects_v2_status_update",
  "github_app_authorization"
]);
const GITHUB_WEBHOOK_RECEIVED_MESSAGE = "GitHub webhook received";
const UNSUPPORTED_GITHUB_WEBHOOK_MESSAGE =
  "Unsupported GitHub webhook event ignored";
const INVALID_GITHUB_WEBHOOK_SIGNATURE_MESSAGE =
  "Invalid GitHub webhook signature";

@Injectable()
export class GithubIntegrationService {
  private readonly githubOAuthIntegrationService: GithubOAuthIntegrationService;
  private readonly githubAppInstallationService: GithubAppInstallationService;
  private readonly githubSourceReadService: GithubSourceReadService;
  private readonly githubProjectV2Service: GithubProjectV2Service;
  private readonly githubPullRequestRemoteService: GithubPullRequestRemoteService;

  constructor(
    private readonly database: DatabaseService,
    private readonly githubOAuthClient: GithubOAuthClient,
    private readonly stateService: GithubOAuthStateService,
    private readonly tokenEncryptionService: GithubTokenEncryptionService,
    private readonly configService: GithubIntegrationConfigService,
    private readonly workspaceService: WorkspaceService,
    private readonly installationStateService: GithubAppInstallationStateService,
    private readonly githubAppClient: GithubAppClient,
    @Optional()
    githubOAuthIntegrationService?: GithubOAuthIntegrationService,
    @Optional()
    githubAppInstallationService?: GithubAppInstallationService,
    @Optional()
    githubSourceReadService?: GithubSourceReadService,
    @Optional()
    githubProjectV2Service?: GithubProjectV2Service,
    @Optional()
    githubPullRequestRemoteService?: GithubPullRequestRemoteService
  ) {
    this.githubOAuthIntegrationService =
      githubOAuthIntegrationService ??
      new GithubOAuthIntegrationService(
        database,
        githubOAuthClient,
        stateService,
        tokenEncryptionService,
        configService
      );
    this.githubAppInstallationService =
      githubAppInstallationService ??
      new GithubAppInstallationService(
        database,
        githubOAuthClient,
        tokenEncryptionService,
        configService,
        workspaceService,
        installationStateService,
        githubAppClient
      );
    this.githubSourceReadService =
      githubSourceReadService ??
      new GithubSourceReadService(database, workspaceService);
    this.githubProjectV2Service =
      githubProjectV2Service ??
      new GithubProjectV2Service(database, workspaceService);
    this.githubPullRequestRemoteService =
      githubPullRequestRemoteService ??
      new GithubPullRequestRemoteService(
        database,
        githubAppClient,
        configService,
        workspaceService
      );
  }

  getModuleInfo(): GitHubIntegrationModuleInfo {
    return {
      domain: "github-integration",
      apiContract: "docs/api/github-integration-api.md"
    };
  }

  async receiveGithubWebhook(
    input: GithubWebhookRequest
  ): Promise<GithubWebhookDeliveryPayload> {
    const deliveryId = this.validateRequiredString(
      input.deliveryId,
      "GitHub webhook delivery id is required"
    );
    const eventName = this.validateRequiredString(
      input.eventName,
      "GitHub webhook event name is required"
    );
    const signature256 = this.validateRequiredString(
      input.signature256,
      "GitHub webhook signature is required"
    );
    const rawBody = this.validateGithubWebhookRawBody(input.rawBody);
    const config = this.configService.getGithubWebhookConfig();

    if (
      !this.isValidGithubWebhookSignature(
        rawBody,
        signature256,
        config.webhookSecret
      )
    ) {
      await this.recordGithubWebhookDelivery({
        deliveryId,
        eventName,
        status: "failed",
        errorMessage: INVALID_GITHUB_WEBHOOK_SIGNATURE_MESSAGE
      });
      throw badRequest(INVALID_GITHUB_WEBHOOK_SIGNATURE_MESSAGE);
    }

    const existing = await this.findGithubWebhookDelivery(deliveryId);
    if (existing) {
      return this.mapGithubWebhookDelivery(existing);
    }

    this.assertGithubWebhookPayload(rawBody, input.body);

    const status: GithubWebhookDeliveryStatus =
      SUPPORTED_GITHUB_WEBHOOK_EVENTS.has(eventName) ? "received" : "ignored";
    const row = await this.recordGithubWebhookDelivery({
      deliveryId,
      eventName,
      status,
      errorMessage:
        status === "ignored" ? UNSUPPORTED_GITHUB_WEBHOOK_MESSAGE : null
    });

    return this.mapGithubWebhookDelivery(row);
  }

  async getGithubOAuthStatus(currentUserId: string): Promise<GithubOAuthStatusPayload> {
    return this.githubOAuthIntegrationService.getGithubOAuthStatus(currentUserId);
  }

  startGithubOAuth(
    currentUserId: string,
    input: StartGithubOAuthRequest | undefined
  ): GithubOAuthStartPayload {
    return this.githubOAuthIntegrationService.startGithubOAuth(currentUserId, input);
  }

  async completeGithubOAuthCallback(
    query: GithubOAuthCallbackQuery
  ): Promise<GithubOAuthCallbackPayload> {
    return this.githubOAuthIntegrationService.completeGithubOAuthCallback(query);
  }

  async disconnectGithubOAuth(
    currentUserId: string
  ): Promise<GithubOAuthDisconnectPayload> {
    return this.githubOAuthIntegrationService.disconnectGithubOAuth(currentUserId);
  }

  async startGithubAppInstallation(
    currentUserId: string,
    workspaceId: string,
    input: StartGithubAppInstallationRequest | undefined
  ): Promise<GithubAppInstallationStartPayload> {
    return this.githubAppInstallationService.startGithubAppInstallation(
      currentUserId,
      workspaceId,
      input
    );
  }

  async completeGithubAppInstallationCallback(
    query: GithubAppInstallationCallbackQuery
  ): Promise<GithubAppInstallationCallbackPayload> {
    return this.githubAppInstallationService.completeGithubAppInstallationCallback(
      query
    );
  }

  async listGithubAppInstallations(
    currentUserId: string,
    workspaceId: string
  ): Promise<GithubAppInstallationPayload[]> {
    return this.githubAppInstallationService.listGithubAppInstallations(
      currentUserId,
      workspaceId
    );
  }

  async listGithubRepositories(
    currentUserId: string,
    workspaceId: string,
    query: ListGithubRepositoriesQuery
  ): Promise<GithubPaginatedPayload<GithubRepositoryListItemPayload>> {
    return this.githubSourceReadService.listGithubRepositories(
      currentUserId,
      workspaceId,
      query
    );
  }

  async getGithubRepository(
    currentUserId: string,
    workspaceId: string,
    repositoryId: string
  ): Promise<GithubRepositoryDetailPayload> {
    return this.githubSourceReadService.getGithubRepository(
      currentUserId,
      workspaceId,
      repositoryId
    );
  }

  async listGithubProjectsV2(
    currentUserId: string,
    workspaceId: string,
    query: ListGithubProjectsV2Query
  ): Promise<GithubPaginatedPayload<GithubProjectV2ListItemPayload>> {
    return this.githubProjectV2Service.listGithubProjectsV2(
      currentUserId,
      workspaceId,
      query
    );
  }

  async getGithubProjectV2(
    currentUserId: string,
    workspaceId: string,
    projectV2Id: string
  ): Promise<GithubProjectV2DetailPayload> {
    return this.githubProjectV2Service.getGithubProjectV2(
      currentUserId,
      workspaceId,
      projectV2Id
    );
  }

  async listGithubProjectV2Fields(
    currentUserId: string,
    workspaceId: string,
    projectV2Id: string
  ): Promise<GithubProjectV2FieldPayload[]> {
    return this.githubProjectV2Service.listGithubProjectV2Fields(
      currentUserId,
      workspaceId,
      projectV2Id
    );
  }

  async listGithubProjectV2StatusOptions(
    currentUserId: string,
    workspaceId: string,
    projectV2Id: string
  ): Promise<GithubProjectV2StatusOptionPayload[]> {
    return this.githubProjectV2Service.listGithubProjectV2StatusOptions(
      currentUserId,
      workspaceId,
      projectV2Id
    );
  }

  async getGithubProjectV2Kanban(
    currentUserId: string,
    workspaceId: string,
    projectV2Id: string
  ): Promise<GithubProjectV2KanbanPayload> {
    return this.githubProjectV2Service.getGithubProjectV2Kanban(
      currentUserId,
      workspaceId,
      projectV2Id
    );
  }

  async listGithubProjectV2Items(
    currentUserId: string,
    workspaceId: string,
    projectV2Id: string
  ): Promise<GithubProjectV2ItemPayload[]> {
    return this.githubProjectV2Service.listGithubProjectV2Items(
      currentUserId,
      workspaceId,
      projectV2Id
    );
  }

  async getGithubIssue(
    currentUserId: string,
    workspaceId: string,
    issueId: string
  ): Promise<GithubIssuePayload> {
    return this.githubSourceReadService.getGithubIssue(
      currentUserId,
      workspaceId,
      issueId
    );
  }

  async listGithubPullRequests(
    currentUserId: string,
    workspaceId: string,
    repositoryId: string,
    query: ListGithubPullRequestsQuery
  ): Promise<GithubPaginatedPayload<GithubPullRequestListItemPayload>> {
    return this.githubSourceReadService.listGithubPullRequests(
      currentUserId,
      workspaceId,
      repositoryId,
      query
    );
  }

  async getGithubPullRequest(
    currentUserId: string,
    workspaceId: string,
    pullRequestId: string
  ): Promise<GithubPullRequestDetailPayload> {
    return this.githubSourceReadService.getGithubPullRequest(
      currentUserId,
      workspaceId,
      pullRequestId
    );
  }

  async listGithubPullRequestFiles(
    currentUserId: string,
    workspaceId: string,
    pullRequestId: string,
    query: ListGithubPullRequestFilesQuery
  ): Promise<GithubPaginatedPayload<GithubPullRequestFilePayload>> {
    return this.githubPullRequestRemoteService.listGithubPullRequestFiles(
      currentUserId,
      workspaceId,
      pullRequestId,
      query
    );
  }

  async getGithubPullRequestConflictStatus(
    currentUserId: string,
    workspaceId: string,
    pullRequestId: string
  ): Promise<GithubPullRequestConflictStatusPayload> {
    return this.githubPullRequestRemoteService.getGithubPullRequestConflictStatus(
      currentUserId,
      workspaceId,
      pullRequestId
    );
  }

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

    try {
      const config = this.configService.getGithubAppConfig();
      const summary = await this.runGithubSyncTarget(target, {
        currentUserId,
        workspaceId,
        installation,
        repository,
        projectV2,
        config
      });
      const completed = await this.completeGithubSyncRunSuccess(syncRun.id, summary);
      return this.mapGithubSyncRun(completed);
    } catch (error) {
      const failed = await this.completeGithubSyncRunFailure(
        syncRun.id,
        this.getGithubSyncErrorMessage(error)
      );
      return this.mapGithubSyncRun(failed);
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

  private mapGithubWebhookDelivery(
    row: GithubWebhookDeliveryRow
  ): GithubWebhookDeliveryPayload {
    if (row.status !== "received" && row.status !== "ignored") {
      throw badRequest("GitHub webhook delivery could not be recorded");
    }

    const receivedAt = this.toNullableIsoString(row.received_at);
    if (!receivedAt) {
      throw badRequest("GitHub webhook delivery could not be recorded");
    }

    return {
      deliveryId: row.delivery_id,
      eventName: row.event_name,
      status: row.status,
      receivedAt,
      processedAt: this.toNullableIsoString(row.processed_at),
      message: this.getGithubWebhookDeliveryMessage(row)
    };
  }

  private getGithubWebhookDeliveryMessage(row: GithubWebhookDeliveryRow): string {
    if (row.status === "ignored") {
      return row.error_message ?? UNSUPPORTED_GITHUB_WEBHOOK_MESSAGE;
    }

    return GITHUB_WEBHOOK_RECEIVED_MESSAGE;
  }

  private async findGithubWebhookDelivery(
    deliveryId: string
  ): Promise<GithubWebhookDeliveryRow | null> {
    return this.database.queryOne<GithubWebhookDeliveryRow>(
      `
        SELECT
          delivery_id,
          event_name,
          status,
          received_at,
          processed_at,
          error_message
        FROM github_webhook_deliveries
        WHERE delivery_id = $1
      `,
      [deliveryId]
    );
  }

  private async recordGithubWebhookDelivery(input: {
    deliveryId: string;
    eventName: string;
    status: GithubWebhookDeliveryStatus | "failed";
    errorMessage: string | null;
  }): Promise<GithubWebhookDeliveryRow> {
    const row = await this.database.queryOne<GithubWebhookDeliveryRow>(
      `
        INSERT INTO github_webhook_deliveries (
          delivery_id,
          event_name,
          status,
          processed_at,
          error_message
        )
        VALUES (
          $1,
          $2,
          $3,
          CASE WHEN $3 = 'received' THEN NULL ELSE now() END,
          $4
        )
        ON CONFLICT (delivery_id)
        DO NOTHING
        RETURNING
          delivery_id,
          event_name,
          status,
          received_at,
          processed_at,
          error_message
      `,
      [input.deliveryId, input.eventName, input.status, input.errorMessage]
    );

    if (row) {
      return row;
    }

    const existing = await this.findGithubWebhookDelivery(input.deliveryId);
    if (!existing) {
      throw badRequest("GitHub webhook delivery could not be recorded");
    }

    return existing;
  }

  private validateGithubWebhookRawBody(value: unknown): Buffer {
    if (!Buffer.isBuffer(value) || value.length === 0) {
      throw badRequest("GitHub webhook raw body is required");
    }

    return value;
  }

  private assertGithubWebhookPayload(rawBody: Buffer, parsedBody: unknown): void {
    if (parsedBody !== undefined) {
      return;
    }

    try {
      JSON.parse(rawBody.toString("utf8")) as unknown;
    } catch {
      throw badRequest("GitHub webhook payload must be JSON");
    }
  }

  private isValidGithubWebhookSignature(
    rawBody: Buffer,
    signature256: string,
    secret: string
  ): boolean {
    if (!signature256.startsWith("sha256=")) {
      return false;
    }

    const expected = `sha256=${createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex")}`;
    const actualBuffer = Buffer.from(signature256, "utf8");
    const expectedBuffer = Buffer.from(expected, "utf8");

    if (actualBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(actualBuffer, expectedBuffer);
  }

  private mapGithubSyncRun(row: GithubSyncRunRow): GithubSyncRunPayload {
    const startedAt = this.toNullableIsoString(row.started_at);
    if (!startedAt) {
      throw badRequest("Invalid GitHub sync start time");
    }

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
          target
        )
        VALUES ($1, $2, $3, $4, $5)
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
        summary.cursor
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

  private async runGithubSyncTarget(
    target: GithubSyncTarget,
    context: GithubSyncRunContext
  ): Promise<GithubSyncRunSummary> {
    switch (target) {
      case "repositories":
        return this.syncGithubRepositories(context);
      case "issues":
        return this.syncGithubIssues(context);
      case "pull_requests":
        return this.syncGithubPullRequests(context);
      case "project_v2":
        return this.syncGithubProjectV2(context);
      case "project_v2_fields":
        return this.syncGithubProjectV2Fields(context);
      case "project_v2_items":
        return this.syncGithubProjectV2Items(context);
      case "full":
        return this.syncGithubFull(context);
    }
  }

  private async syncGithubFull(
    context: GithubSyncRunContext
  ): Promise<GithubSyncRunSummary> {
    let summary = this.createGithubSyncSummary();
    summary = this.mergeGithubSyncSummaries(
      summary,
      await this.syncGithubRepositories(context)
    );
    summary = this.mergeGithubSyncSummaries(
      summary,
      await this.syncGithubIssues(context)
    );
    summary = this.mergeGithubSyncSummaries(
      summary,
      await this.syncGithubPullRequests(context)
    );

    if (context.projectV2) {
      summary = this.mergeGithubSyncSummaries(
        summary,
        await this.syncGithubProjectV2(context)
      );
      summary = this.mergeGithubSyncSummaries(
        summary,
        await this.syncGithubProjectV2Fields(context)
      );
      summary = this.mergeGithubSyncSummaries(
        summary,
        await this.syncGithubProjectV2Items(context)
      );
    }

    return summary;
  }

  private async syncGithubRepositories(
    context: GithubSyncRunContext
  ): Promise<GithubSyncRunSummary> {
    const repositories = await this.githubAppClient.listInstallationRepositories({
      installationId: this.toNumber(context.installation.github_installation_id),
      appId: context.config.appId,
      privateKey: context.config.privateKey,
      now: context.config.now
    });

    let createdCount = 0;
    let updatedCount = 0;
    for (const repository of repositories) {
      const row = await this.upsertGithubRepository(context, repository);
      if (row.created) {
        createdCount += 1;
      } else {
        updatedCount += 1;
      }
    }

    await this.markGithubInstallationSynced(context.installation.id);

    return this.createGithubSyncSummary({
      fetchedCount: repositories.length,
      createdCount,
      updatedCount
    });
  }

  private async syncGithubIssues(
    context: GithubSyncRunContext
  ): Promise<GithubSyncRunSummary> {
    const repositories = await this.getGithubSyncRepositoriesForTarget(context);
    let fetchedCount = 0;
    let createdCount = 0;
    let updatedCount = 0;

    for (const repository of repositories) {
      const issues = await this.githubAppClient.listRepositoryIssues({
        installationId: this.toNumber(context.installation.github_installation_id),
        appId: context.config.appId,
        privateKey: context.config.privateKey,
        owner: repository.owner_login,
        repo: repository.name,
        now: context.config.now
      });
      fetchedCount += issues.length;

      for (const issue of issues) {
        const row = await this.upsertGithubIssue(context.workspaceId, repository.id, issue);
        if (row.created) {
          createdCount += 1;
        } else {
          updatedCount += 1;
        }
      }

      await this.markGithubRepositorySynced(repository.id);
    }

    return this.createGithubSyncSummary({
      fetchedCount,
      createdCount,
      updatedCount
    });
  }

  private async syncGithubPullRequests(
    context: GithubSyncRunContext
  ): Promise<GithubSyncRunSummary> {
    const repositories = await this.getGithubSyncRepositoriesForTarget(context);
    let fetchedCount = 0;
    let createdCount = 0;
    let updatedCount = 0;

    for (const repository of repositories) {
      const pullRequests = await this.githubAppClient.listRepositoryPullRequests({
        installationId: this.toNumber(context.installation.github_installation_id),
        appId: context.config.appId,
        privateKey: context.config.privateKey,
        owner: repository.owner_login,
        repo: repository.name,
        now: context.config.now
      });
      fetchedCount += pullRequests.length;

      for (const pullRequest of pullRequests) {
        const row = await this.upsertGithubPullRequest(
          context.workspaceId,
          repository.id,
          pullRequest
        );
        if (row.created) {
          createdCount += 1;
        } else {
          updatedCount += 1;
        }
      }

      await this.markGithubRepositorySynced(repository.id);
    }

    return this.createGithubSyncSummary({
      fetchedCount,
      createdCount,
      updatedCount
    });
  }

  private async syncGithubProjectV2(
    context: GithubSyncRunContext
  ): Promise<GithubSyncRunSummary> {
    const projectV2 = this.requireGithubSyncProjectV2(context);
    await this.database.execute(
      `
        UPDATE github_projects_v2
        SET last_synced_at = now()
        WHERE id = $1
      `,
      [projectV2.id]
    );

    return this.createGithubSyncSummary({
      fetchedCount: 1,
      updatedCount: 1
    });
  }

  private async syncGithubProjectV2Fields(
    context: GithubSyncRunContext
  ): Promise<GithubSyncRunSummary> {
    const projectV2 = this.requireGithubSyncProjectV2(context);
    const fieldCount = await this.countRows(
      `
        SELECT COUNT(*)::int AS total
        FROM github_project_v2_fields
        WHERE project_v2_id = $1
      `,
      [projectV2.id]
    );

    return this.createGithubSyncSummary({
      fetchedCount: fieldCount,
      skippedCount: fieldCount
    });
  }

  private async syncGithubProjectV2Items(
    context: GithubSyncRunContext
  ): Promise<GithubSyncRunSummary> {
    const projectV2 = this.requireGithubSyncProjectV2(context);
    const itemCount = await this.countRows(
      `
        SELECT COUNT(*)::int AS total
        FROM github_project_v2_items
        WHERE project_v2_id = $1
      `,
      [projectV2.id]
    );
    await this.database.execute(
      `
        UPDATE github_project_v2_items
        SET last_synced_at = now()
        WHERE project_v2_id = $1
      `,
      [projectV2.id]
    );

    return this.createGithubSyncSummary({
      fetchedCount: itemCount,
      updatedCount: itemCount
    });
  }

  private async upsertGithubRepository(
    context: GithubSyncRunContext,
    repository: GithubInstallationRepositoryApiItem
  ): Promise<GithubSyncUpsertResultRow> {
    const row = await this.database.queryOne<GithubSyncUpsertResultRow>(
      `
        INSERT INTO github_repositories (
          workspace_id,
          installation_id,
          connected_by_user_id,
          github_repository_id,
          github_node_id,
          owner_login,
          name,
          full_name,
          private,
          archived,
          default_branch,
          html_url,
          github_created_at,
          github_updated_at,
          pushed_at,
          last_synced_at,
          raw
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14,
          $15,
          now(),
          $16::jsonb
        )
        ON CONFLICT (github_repository_id)
        DO UPDATE SET
          workspace_id = EXCLUDED.workspace_id,
          installation_id = EXCLUDED.installation_id,
          connected_by_user_id = EXCLUDED.connected_by_user_id,
          github_node_id = EXCLUDED.github_node_id,
          owner_login = EXCLUDED.owner_login,
          name = EXCLUDED.name,
          full_name = EXCLUDED.full_name,
          private = EXCLUDED.private,
          archived = EXCLUDED.archived,
          default_branch = EXCLUDED.default_branch,
          html_url = EXCLUDED.html_url,
          github_created_at = EXCLUDED.github_created_at,
          github_updated_at = EXCLUDED.github_updated_at,
          pushed_at = EXCLUDED.pushed_at,
          last_synced_at = now(),
          raw = EXCLUDED.raw,
          updated_at = now()
        RETURNING id, (xmax = 0) AS created
      `,
      [
        context.workspaceId,
        context.installation.id,
        context.currentUserId,
        repository.id,
        repository.node_id,
        repository.owner.login,
        repository.name,
        repository.full_name,
        repository.private,
        repository.archived,
        repository.default_branch ?? null,
        repository.html_url,
        repository.created_at ?? null,
        repository.updated_at ?? null,
        repository.pushed_at ?? null,
        repository
      ]
    );

    if (!row) {
      throw badRequest("GitHub repository could not be synced");
    }

    return row;
  }

  private async upsertGithubIssue(
    workspaceId: string,
    repositoryId: string,
    issue: GithubIssueApiItem
  ): Promise<GithubSyncUpsertResultRow> {
    const row = await this.database.queryOne<GithubSyncUpsertResultRow>(
      `
        INSERT INTO github_issues (
          workspace_id,
          repository_id,
          github_issue_id,
          github_node_id,
          issue_number,
          title,
          body,
          state,
          state_reason,
          author_login,
          author_avatar_url,
          html_url,
          labels,
          assignees,
          milestone,
          github_created_at,
          github_updated_at,
          github_closed_at,
          last_synced_at,
          raw
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13::jsonb,
          $14::jsonb,
          $15::jsonb,
          $16,
          $17,
          $18,
          now(),
          $19::jsonb
        )
        ON CONFLICT (github_issue_id)
        DO UPDATE SET
          workspace_id = EXCLUDED.workspace_id,
          repository_id = EXCLUDED.repository_id,
          github_node_id = EXCLUDED.github_node_id,
          issue_number = EXCLUDED.issue_number,
          title = EXCLUDED.title,
          body = EXCLUDED.body,
          state = EXCLUDED.state,
          state_reason = EXCLUDED.state_reason,
          author_login = EXCLUDED.author_login,
          author_avatar_url = EXCLUDED.author_avatar_url,
          html_url = EXCLUDED.html_url,
          labels = EXCLUDED.labels,
          assignees = EXCLUDED.assignees,
          milestone = EXCLUDED.milestone,
          github_created_at = EXCLUDED.github_created_at,
          github_updated_at = EXCLUDED.github_updated_at,
          github_closed_at = EXCLUDED.github_closed_at,
          last_synced_at = now(),
          raw = EXCLUDED.raw,
          updated_at = now()
        RETURNING id, (xmax = 0) AS created
      `,
      [
        workspaceId,
        repositoryId,
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
        issue.labels ?? [],
        issue.assignees ?? [],
        issue.milestone ?? null,
        issue.created_at ?? null,
        issue.updated_at ?? null,
        issue.closed_at ?? null,
        issue
      ]
    );

    if (!row) {
      throw badRequest("GitHub issue could not be synced");
    }

    return row;
  }

  private async upsertGithubPullRequest(
    workspaceId: string,
    repositoryId: string,
    pullRequest: GithubPullRequestApiItem
  ): Promise<GithubSyncUpsertResultRow> {
    const row = await this.database.queryOne<GithubSyncUpsertResultRow>(
      `
        INSERT INTO github_pull_requests (
          workspace_id,
          repository_id,
          github_pull_request_id,
          github_node_id,
          pr_number,
          title,
          body,
          author_login,
          author_avatar_url,
          head_branch,
          base_branch,
          changed_files_count,
          additions,
          deletions,
          commits_count,
          comments_count,
          review_comments_count,
          html_url,
          github_created_at,
          github_updated_at,
          github_closed_at,
          merged_at,
          last_synced_at,
          raw
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14,
          $15,
          $16,
          $17,
          $18,
          $19,
          $20,
          $21,
          $22,
          now(),
          $23::jsonb
        )
        ON CONFLICT (github_pull_request_id)
        DO UPDATE SET
          workspace_id = EXCLUDED.workspace_id,
          repository_id = EXCLUDED.repository_id,
          github_node_id = EXCLUDED.github_node_id,
          pr_number = EXCLUDED.pr_number,
          title = EXCLUDED.title,
          body = EXCLUDED.body,
          author_login = EXCLUDED.author_login,
          author_avatar_url = EXCLUDED.author_avatar_url,
          head_branch = EXCLUDED.head_branch,
          base_branch = EXCLUDED.base_branch,
          changed_files_count = EXCLUDED.changed_files_count,
          additions = EXCLUDED.additions,
          deletions = EXCLUDED.deletions,
          commits_count = EXCLUDED.commits_count,
          comments_count = EXCLUDED.comments_count,
          review_comments_count = EXCLUDED.review_comments_count,
          html_url = EXCLUDED.html_url,
          github_created_at = EXCLUDED.github_created_at,
          github_updated_at = EXCLUDED.github_updated_at,
          github_closed_at = EXCLUDED.github_closed_at,
          merged_at = EXCLUDED.merged_at,
          last_synced_at = now(),
          raw = EXCLUDED.raw,
          updated_at = now()
        RETURNING id, (xmax = 0) AS created
      `,
      [
        workspaceId,
        repositoryId,
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
        pullRequest
      ]
    );

    if (!row) {
      throw badRequest("GitHub pull request could not be synced");
    }

    return row;
  }

  private async markGithubInstallationSynced(installationId: string): Promise<void> {
    await this.database.execute(
      `
        UPDATE github_installations
        SET last_synced_at = now()
        WHERE id = $1
      `,
      [installationId]
    );
  }

  private async markGithubRepositorySynced(repositoryId: string): Promise<void> {
    await this.database.execute(
      `
        UPDATE github_repositories
        SET last_synced_at = now()
        WHERE id = $1
      `,
      [repositoryId]
    );
  }

  private async getGithubSyncRepositoriesForTarget(
    context: GithubSyncRunContext
  ): Promise<GithubSyncRepositoryContextRow[]> {
    if (context.repository) {
      return [context.repository];
    }

    return this.listGithubSyncRepositoriesForInstallation(
      context.workspaceId,
      context.installation.id
    );
  }

  private requireGithubSyncProjectV2(
    context: GithubSyncRunContext
  ): GithubSyncProjectV2ContextRow {
    if (!context.projectV2) {
      throw badRequest("projectV2Id is required for this sync target");
    }

    return context.projectV2;
  }

  private createGithubSyncSummary(
    input: Partial<GithubSyncRunSummary> = {}
  ): GithubSyncRunSummary {
    return {
      fetchedCount: input.fetchedCount ?? 0,
      createdCount: input.createdCount ?? 0,
      updatedCount: input.updatedCount ?? 0,
      skippedCount: input.skippedCount ?? 0,
      cursor: input.cursor ?? {}
    };
  }

  private mergeGithubSyncSummaries(
    left: GithubSyncRunSummary,
    right: GithubSyncRunSummary
  ): GithubSyncRunSummary {
    return {
      fetchedCount: left.fetchedCount + right.fetchedCount,
      createdCount: left.createdCount + right.createdCount,
      updatedCount: left.updatedCount + right.updatedCount,
      skippedCount: left.skippedCount + right.skippedCount,
      cursor: {
        ...left.cursor,
        ...right.cursor
      }
    };
  }

  private getGithubSyncErrorMessage(error: unknown): string {
    const fallback = "GitHub sync failed";
    let message: string | null = null;

    if (error instanceof Error && error.message) {
      message = error.message;
    }

    if (!message && typeof error === "object" && error !== null) {
      const response = (error as { getResponse?: () => unknown }).getResponse?.();
      const responseMessage =
        typeof response === "object" && response !== null
          ? (response as { error?: { message?: unknown } }).error?.message
          : null;
      if (typeof responseMessage === "string" && responseMessage.trim()) {
        message = responseMessage;
      }
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
          github_installation_id
        FROM github_installations
        WHERE workspace_id = $1
          AND id = $2
      `,
      [workspaceId, installationId]
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

  private async listGithubSyncRepositoriesForInstallation(
    workspaceId: string,
    installationId: string
  ): Promise<GithubSyncRepositoryContextRow[]> {
    return this.database.query<GithubSyncRepositoryContextRow>(
      `
        SELECT
          id,
          workspace_id,
          installation_id,
          owner_login,
          name,
          full_name
        FROM github_repositories
        WHERE workspace_id = $1
          AND installation_id = $2
        ORDER BY full_name ASC, id ASC
      `,
      [workspaceId, installationId]
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
          installation_id
        FROM github_projects_v2
        WHERE workspace_id = $1
          AND id = $2
      `,
      [workspaceId, projectV2Id]
    );
  }

  private async countRows(text: string, values: readonly unknown[]): Promise<number> {
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

  private parseGithubInstallationId(value: unknown): number {
    const raw = this.validateRequiredString(
      value,
      "GitHub installation id is required"
    );
    if (!/^\d+$/.test(raw)) {
      throw badRequest("GitHub installation id must be a positive integer");
    }

    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw badRequest("GitHub installation id must be a positive integer");
    }

    return parsed;
  }

  private toNullableNumber(value: string | number | null): number | null {
    if (value === null) {
      return null;
    }

    const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private toInteger(value: string | number, message: string): number {
    const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
    if (!Number.isSafeInteger(parsed)) {
      throw badRequest(message);
    }

    return parsed;
  }

  private toNullableInteger(
    value: string | number | null,
    message: string
  ): number | null {
    if (value === null) {
      return null;
    }

    return this.toInteger(value, message);
  }

  private toNumber(value: string | number): number {
    const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
      throw badRequest("Invalid GitHub installation id");
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

  private toNullableRecord(value: unknown): Record<string, unknown> | null {
    if (value === null || value === undefined) {
      return null;
    }

    const record = this.toRecord(value);
    return Object.keys(record).length > 0 ? record : null;
  }

  private toArray(value: unknown): unknown[] {
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value) as unknown;
        return this.toArray(parsed);
      } catch {
        return [];
      }
    }

    return Array.isArray(value) ? value : [];
  }
}
