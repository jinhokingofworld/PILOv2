import { Injectable, Optional } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import { GithubAppClient } from "./github-app.client";
import { GithubAppInstallationService } from "./github-app-installation.service";
import { GithubAppInstallationStateService } from "./github-app-installation-state.service";
import { GithubIntegrationConfigService } from "./github-integration-config.service";
import { GithubOAuthClient } from "./github-oauth.client";
import { GithubOAuthIntegrationService } from "./github-oauth-integration.service";
import { GithubOAuthStateService } from "./github-oauth-state.service";
import { GithubProjectV2Service } from "./github-project-v2.service";
import { GithubPullRequestRemoteService } from "./github-pull-request-remote.service";
import { GithubReviewSubmissionService } from "./github-review-submission.service";
import { GithubSourceReadService } from "./github-source-read.service";
import { GithubSyncExecutorService } from "./github-sync-executor.service";
import { GithubSyncRunService } from "./github-sync-run.service";
import { GithubTokenEncryptionService } from "./github-token-encryption.service";
import { GithubWebhookService } from "./github-webhook.service";
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
  GithubPullRequestReviewSubmissionPayload,
  GithubWebhookDeliveryPayload,
  GithubRepositoryDetailPayload,
  GithubRepositoryListItemPayload,
  SubmitGithubPullRequestReviewInput,
  GithubSyncRunDetailPayload,
  GithubSyncRunPayload
} from "./types";

@Injectable()
export class GithubIntegrationService {
  private readonly githubOAuthIntegrationService: GithubOAuthIntegrationService;
  private readonly githubAppInstallationService: GithubAppInstallationService;
  private readonly githubSourceReadService: GithubSourceReadService;
  private readonly githubProjectV2Service: GithubProjectV2Service;
  private readonly githubPullRequestRemoteService: GithubPullRequestRemoteService;
  private readonly githubReviewSubmissionService: GithubReviewSubmissionService;
  private readonly githubWebhookService: GithubWebhookService;
  private readonly githubSyncRunService: GithubSyncRunService;

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
    githubPullRequestRemoteService?: GithubPullRequestRemoteService,
    @Optional()
    githubWebhookService?: GithubWebhookService,
    @Optional()
    githubSyncExecutorService?: GithubSyncExecutorService,
    @Optional()
    githubSyncRunService?: GithubSyncRunService,
    @Optional()
    githubReviewSubmissionService?: GithubReviewSubmissionService
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
    this.githubReviewSubmissionService =
      githubReviewSubmissionService ??
      new GithubReviewSubmissionService(
        database,
        githubOAuthClient,
        tokenEncryptionService,
        configService,
        workspaceService
      );
    const syncExecutorService =
      githubSyncExecutorService ??
      new GithubSyncExecutorService(database, githubAppClient);
    this.githubWebhookService =
      githubWebhookService ?? new GithubWebhookService(database, configService);
    this.githubSyncRunService =
      githubSyncRunService ??
      new GithubSyncRunService(
        database,
        configService,
        workspaceService,
        syncExecutorService
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
    return this.githubWebhookService.receiveGithubWebhook(input);
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

  async submitGithubPullRequestReview(
    currentUserId: string,
    workspaceId: string,
    pullRequestId: string,
    input: SubmitGithubPullRequestReviewInput
  ): Promise<GithubPullRequestReviewSubmissionPayload> {
    return this.githubReviewSubmissionService.submitGithubPullRequestReview(
      currentUserId,
      workspaceId,
      pullRequestId,
      input
    );
  }

  async startGithubSyncRun(
    currentUserId: string,
    workspaceId: string,
    input: StartGithubSyncRunRequest | undefined
  ): Promise<GithubSyncRunPayload> {
    return this.githubSyncRunService.startGithubSyncRun(
      currentUserId,
      workspaceId,
      input
    );
  }

  async listGithubSyncRuns(
    currentUserId: string,
    workspaceId: string,
    query: ListGithubSyncRunsQuery
  ): Promise<GithubPaginatedPayload<GithubSyncRunPayload>> {
    return this.githubSyncRunService.listGithubSyncRuns(
      currentUserId,
      workspaceId,
      query
    );
  }

  async getGithubSyncRun(
    currentUserId: string,
    workspaceId: string,
    syncRunId: string
  ): Promise<GithubSyncRunDetailPayload> {
    return this.githubSyncRunService.getGithubSyncRun(
      currentUserId,
      workspaceId,
      syncRunId
    );
  }
}
