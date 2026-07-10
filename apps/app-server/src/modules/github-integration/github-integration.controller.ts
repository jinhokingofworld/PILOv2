import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
  RawBody,
  Res,
  UseGuards
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { apiResponse, ApiSuccessResponse } from "../../common/api-response";
import { AuthGuard } from "../../common/auth.guard";
import { CurrentUserId } from "../../common/current-user.decorator";
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
import { GithubIntegrationService } from "./github-integration.service";
import {
  appendGithubOAuthCallbackError,
  GITHUB_OAUTH_ACCOUNT_ALREADY_CONNECTED_QUERY_VALUE,
  GithubOAuthAccountAlreadyConnectedError
} from "./github-oauth-callback-error";
import type {
  GithubAppInstallationCallbackPayload,
  GithubAppInstallationDeletePayload,
  GithubAppInstallationPayload,
  GithubAppInstallationStartPayload,
  GithubIssuePayload,
  GithubOAuthCallbackPayload,
  GithubOAuthDisconnectPayload,
  GithubOAuthStartPayload,
  GithubOAuthStatusPayload,
  GithubPaginatedPayload,
  GithubPaginationMeta,
  GithubProjectOAuthCallbackPayload,
  GithubProjectOAuthDisconnectPayload,
  GithubProjectOAuthStartPayload,
  GithubProjectOAuthStatusPayload,
  GithubProjectV2AccessStatusPayload,
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
  GithubRepositoryDetailPayload,
  GithubRepositoryCollaboratorStatusPayload,
  GithubRepositoryListItemPayload,
  GithubSyncRunDetailPayload,
  GithubSyncRunPayload
} from "./types";

interface ApiSuccessResponseWithMeta<T> extends ApiSuccessResponse<T> {
  meta: GithubPaginationMeta;
}

function apiPaginatedResponse<T>(
  payload: GithubPaginatedPayload<T>
): ApiSuccessResponseWithMeta<T[]> {
  return {
    success: true,
    data: payload.data,
    meta: payload.meta
  };
}

function redirectToReturnUrl(reply: FastifyReply, returnUrl: string | null): boolean {
  if (!returnUrl) {
    return false;
  }

  reply.redirect(returnUrl, 302);
  return true;
}

function redirectToGithubOAuthCallbackError(
  reply: FastifyReply,
  returnUrl: string | null,
  errorValue: string
): boolean {
  if (!returnUrl) {
    return false;
  }

  reply.redirect(appendGithubOAuthCallbackError(returnUrl, errorValue), 302);
  return true;
}

@Controller()
export class GithubIntegrationController {
  constructor(private readonly githubIntegrationService: GithubIntegrationService) {}

  @Get("me/github")
  @UseGuards(AuthGuard)
  async getGithubOAuthStatus(
    @CurrentUserId() currentUserId: string
  ): Promise<ApiSuccessResponse<GithubOAuthStatusPayload>> {
    const status = await this.githubIntegrationService.getGithubOAuthStatus(
      currentUserId
    );
    return apiResponse(status);
  }

  @Post("me/github/oauth/start")
  @UseGuards(AuthGuard)
  async startGithubOAuth(
    @CurrentUserId() currentUserId: string,
    @Body() body: StartGithubOAuthRequest | undefined,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<ApiSuccessResponse<GithubOAuthStartPayload>> {
    const { stateCookie, ...start } =
      await this.githubIntegrationService.startGithubOAuth(currentUserId, body);
    reply.header("set-cookie", stateCookie);
    return apiResponse(start);
  }

  @Get("github/oauth/callback")
  async completeGithubOAuthCallback(
    @Query() query: GithubOAuthCallbackQuery,
    @Headers("cookie") cookieHeader: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<ApiSuccessResponse<GithubOAuthCallbackPayload> | undefined> {
    let result: GithubOAuthCallbackPayload;
    try {
      result = await this.githubIntegrationService.completeGithubOAuthCallback(
        query,
        cookieHeader
      );
    } catch (error) {
      if (
        error instanceof GithubOAuthAccountAlreadyConnectedError &&
        redirectToGithubOAuthCallbackError(
          reply,
          error.returnUrl,
          GITHUB_OAUTH_ACCOUNT_ALREADY_CONNECTED_QUERY_VALUE
        )
      ) {
        return undefined;
      }

      throw error;
    }

    if (redirectToReturnUrl(reply, result.returnUrl)) {
      return undefined;
    }

    return apiResponse(result);
  }

  @Delete("me/github")
  @UseGuards(AuthGuard)
  async disconnectGithubOAuth(
    @CurrentUserId() currentUserId: string
  ): Promise<ApiSuccessResponse<GithubOAuthDisconnectPayload>> {
    const result = await this.githubIntegrationService.disconnectGithubOAuth(
      currentUserId
    );
    return apiResponse(result);
  }

  @Get("me/github/project-oauth")
  @UseGuards(AuthGuard)
  async getGithubProjectOAuthStatus(
    @CurrentUserId() currentUserId: string
  ): Promise<ApiSuccessResponse<GithubProjectOAuthStatusPayload>> {
    const status =
      await this.githubIntegrationService.getGithubProjectOAuthStatus(
        currentUserId
      );
    return apiResponse(status);
  }

  @Post("me/github/project-oauth/start")
  @UseGuards(AuthGuard)
  async startGithubProjectOAuth(
    @CurrentUserId() currentUserId: string,
    @Body() body: StartGithubOAuthRequest | undefined,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<ApiSuccessResponse<GithubProjectOAuthStartPayload>> {
    const { stateCookie, ...start } =
      await this.githubIntegrationService.startGithubProjectOAuth(
        currentUserId,
        body
      );
    reply.header("set-cookie", stateCookie);
    return apiResponse(start);
  }

  @Get("github/project-oauth/callback")
  async completeGithubProjectOAuthCallback(
    @Query() query: GithubOAuthCallbackQuery,
    @Headers("cookie") cookieHeader: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<ApiSuccessResponse<GithubProjectOAuthCallbackPayload> | undefined> {
    const result =
      await this.githubIntegrationService.completeGithubProjectOAuthCallback(
        query,
        cookieHeader
      );
    if (redirectToReturnUrl(reply, result.returnUrl)) {
      return undefined;
    }

    return apiResponse(result);
  }

  @Delete("me/github/project-oauth")
  @UseGuards(AuthGuard)
  async disconnectGithubProjectOAuth(
    @CurrentUserId() currentUserId: string
  ): Promise<ApiSuccessResponse<GithubProjectOAuthDisconnectPayload>> {
    const result =
      await this.githubIntegrationService.disconnectGithubProjectOAuth(
        currentUserId
      );
    return apiResponse(result);
  }

  @Post("workspaces/:workspaceId/github/installations/start")
  @UseGuards(AuthGuard)
  async startGithubAppInstallation(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Body() body: StartGithubAppInstallationRequest | undefined,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<ApiSuccessResponse<GithubAppInstallationStartPayload>> {
    const { stateCookie, ...result } =
      await this.githubIntegrationService.startGithubAppInstallation(
        currentUserId,
        workspaceId,
        body
      );
    reply.header("set-cookie", stateCookie);
    return apiResponse(result);
  }

  @Get("github/installations/callback")
  async completeGithubAppInstallationCallback(
    @Query() query: GithubAppInstallationCallbackQuery,
    @Headers("cookie") cookieHeader: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<ApiSuccessResponse<GithubAppInstallationCallbackPayload> | undefined> {
    const result =
      await this.githubIntegrationService.completeGithubAppInstallationCallback(
        query,
        cookieHeader
      );
    if (redirectToReturnUrl(reply, result.returnUrl)) {
      return undefined;
    }

    return apiResponse(result);
  }

  @Post("github/webhooks")
  async receiveGithubWebhook(
    @Headers("x-github-delivery") deliveryId: string | undefined,
    @Headers("x-github-event") eventName: string | undefined,
    @Headers("x-hub-signature-256") signature256: string | undefined,
    @RawBody() rawBody: Buffer | undefined,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<GithubWebhookDeliveryPayload>> {
    const request: GithubWebhookRequest = {
      deliveryId,
      eventName,
      signature256,
      rawBody,
      body
    };
    const result =
      await this.githubIntegrationService.receiveGithubWebhook(request);
    return apiResponse(result);
  }

  @Get("workspaces/:workspaceId/github/installations")
  @UseGuards(AuthGuard)
  async listGithubAppInstallations(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string
  ): Promise<ApiSuccessResponse<GithubAppInstallationPayload[]>> {
    const result = await this.githubIntegrationService.listGithubAppInstallations(
      currentUserId,
      workspaceId
    );
    return apiResponse(result);
  }

  @Delete("workspaces/:workspaceId/github/installations/:installationId")
  @UseGuards(AuthGuard)
  async deleteGithubAppInstallation(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("installationId") installationId: string
  ): Promise<ApiSuccessResponse<GithubAppInstallationDeletePayload>> {
    const result = await this.githubIntegrationService.deleteGithubAppInstallation(
      currentUserId,
      workspaceId,
      installationId
    );
    return apiResponse(result);
  }

  @Post("workspaces/:workspaceId/github/sync-runs")
  @UseGuards(AuthGuard)
  async startGithubSyncRun(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Body() body: StartGithubSyncRunRequest | undefined
  ): Promise<ApiSuccessResponse<GithubSyncRunPayload>> {
    const result = await this.githubIntegrationService.startGithubSyncRun(
      currentUserId,
      workspaceId,
      body
    );
    return apiResponse(result);
  }

  @Get("workspaces/:workspaceId/github/sync-runs")
  @UseGuards(AuthGuard)
  async listGithubSyncRuns(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Query() query: ListGithubSyncRunsQuery
  ): Promise<ApiSuccessResponseWithMeta<GithubSyncRunPayload[]>> {
    const result = await this.githubIntegrationService.listGithubSyncRuns(
      currentUserId,
      workspaceId,
      query
    );
    return apiPaginatedResponse(result);
  }

  @Get("workspaces/:workspaceId/github/sync-runs/:syncRunId")
  @UseGuards(AuthGuard)
  async getGithubSyncRun(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("syncRunId") syncRunId: string
  ): Promise<ApiSuccessResponse<GithubSyncRunDetailPayload>> {
    const result = await this.githubIntegrationService.getGithubSyncRun(
      currentUserId,
      workspaceId,
      syncRunId
    );
    return apiResponse(result);
  }

  @Get("workspaces/:workspaceId/github/repositories")
  @UseGuards(AuthGuard)
  async listGithubRepositories(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Query() query: ListGithubRepositoriesQuery
  ): Promise<ApiSuccessResponseWithMeta<GithubRepositoryListItemPayload[]>> {
    const result = await this.githubIntegrationService.listGithubRepositories(
      currentUserId,
      workspaceId,
      query
    );
    return apiPaginatedResponse(result);
  }

  @Get("workspaces/:workspaceId/github/repositories/:repositoryId/collaborator-status")
  @UseGuards(AuthGuard)
  async getGithubRepositoryCollaboratorStatus(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("repositoryId") repositoryId: string
  ): Promise<ApiSuccessResponse<GithubRepositoryCollaboratorStatusPayload>> {
    const result =
      await this.githubIntegrationService.getGithubRepositoryCollaboratorStatus(
        currentUserId,
        workspaceId,
        repositoryId
      );
    return apiResponse(result);
  }

  @Get("workspaces/:workspaceId/github/repositories/:repositoryId")
  @UseGuards(AuthGuard)
  async getGithubRepository(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("repositoryId") repositoryId: string
  ): Promise<ApiSuccessResponse<GithubRepositoryDetailPayload>> {
    const result = await this.githubIntegrationService.getGithubRepository(
      currentUserId,
      workspaceId,
      repositoryId
    );
    return apiResponse(result);
  }

  @Get("workspaces/:workspaceId/github/projects-v2")
  @UseGuards(AuthGuard)
  async listGithubProjectsV2(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Query() query: ListGithubProjectsV2Query
  ): Promise<ApiSuccessResponseWithMeta<GithubProjectV2ListItemPayload[]>> {
    const result = await this.githubIntegrationService.listGithubProjectsV2(
      currentUserId,
      workspaceId,
      query
    );
    return apiPaginatedResponse(result);
  }

  @Get("workspaces/:workspaceId/github/projects-v2/:projectV2Id/access-status")
  @UseGuards(AuthGuard)
  async getGithubProjectV2AccessStatus(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("projectV2Id") projectV2Id: string
  ): Promise<ApiSuccessResponse<GithubProjectV2AccessStatusPayload>> {
    const result =
      await this.githubIntegrationService.getGithubProjectV2AccessStatus(
        currentUserId,
        workspaceId,
        projectV2Id
      );
    return apiResponse(result);
  }

  @Get("workspaces/:workspaceId/github/projects-v2/:projectV2Id")
  @UseGuards(AuthGuard)
  async getGithubProjectV2(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("projectV2Id") projectV2Id: string
  ): Promise<ApiSuccessResponse<GithubProjectV2DetailPayload>> {
    const result = await this.githubIntegrationService.getGithubProjectV2(
      currentUserId,
      workspaceId,
      projectV2Id
    );
    return apiResponse(result);
  }

  @Get("workspaces/:workspaceId/github/projects-v2/:projectV2Id/fields")
  @UseGuards(AuthGuard)
  async listGithubProjectV2Fields(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("projectV2Id") projectV2Id: string
  ): Promise<ApiSuccessResponse<GithubProjectV2FieldPayload[]>> {
    const result = await this.githubIntegrationService.listGithubProjectV2Fields(
      currentUserId,
      workspaceId,
      projectV2Id
    );
    return apiResponse(result);
  }

  @Get("workspaces/:workspaceId/github/projects-v2/:projectV2Id/status-options")
  @UseGuards(AuthGuard)
  async listGithubProjectV2StatusOptions(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("projectV2Id") projectV2Id: string
  ): Promise<ApiSuccessResponse<GithubProjectV2StatusOptionPayload[]>> {
    const result =
      await this.githubIntegrationService.listGithubProjectV2StatusOptions(
        currentUserId,
        workspaceId,
        projectV2Id
      );
    return apiResponse(result);
  }

  @Get("workspaces/:workspaceId/github/projects-v2/:projectV2Id/kanban")
  @UseGuards(AuthGuard)
  async getGithubProjectV2Kanban(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("projectV2Id") projectV2Id: string
  ): Promise<ApiSuccessResponse<GithubProjectV2KanbanPayload>> {
    const result = await this.githubIntegrationService.getGithubProjectV2Kanban(
      currentUserId,
      workspaceId,
      projectV2Id
    );
    return apiResponse(result);
  }

  @Get("workspaces/:workspaceId/github/projects-v2/:projectV2Id/items")
  @UseGuards(AuthGuard)
  async listGithubProjectV2Items(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("projectV2Id") projectV2Id: string
  ): Promise<ApiSuccessResponse<GithubProjectV2ItemPayload[]>> {
    const result = await this.githubIntegrationService.listGithubProjectV2Items(
      currentUserId,
      workspaceId,
      projectV2Id
    );
    return apiResponse(result);
  }

  @Get("workspaces/:workspaceId/github/issues/:issueId")
  @UseGuards(AuthGuard)
  async getGithubIssue(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("issueId") issueId: string
  ): Promise<ApiSuccessResponse<GithubIssuePayload>> {
    const result = await this.githubIntegrationService.getGithubIssue(
      currentUserId,
      workspaceId,
      issueId
    );
    return apiResponse(result);
  }

  @Get("workspaces/:workspaceId/github/repositories/:repositoryId/pull-requests")
  @UseGuards(AuthGuard)
  async listGithubPullRequests(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("repositoryId") repositoryId: string,
    @Query() query: ListGithubPullRequestsQuery
  ): Promise<ApiSuccessResponseWithMeta<GithubPullRequestListItemPayload[]>> {
    const result = await this.githubIntegrationService.listGithubPullRequests(
      currentUserId,
      workspaceId,
      repositoryId,
      query
    );
    return apiPaginatedResponse(result);
  }

  @Get("workspaces/:workspaceId/github/pull-requests/:pullRequestId")
  @UseGuards(AuthGuard)
  async getGithubPullRequest(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("pullRequestId") pullRequestId: string
  ): Promise<ApiSuccessResponse<GithubPullRequestDetailPayload>> {
    const result = await this.githubIntegrationService.getGithubPullRequest(
      currentUserId,
      workspaceId,
      pullRequestId
    );
    return apiResponse(result);
  }

  @Get("workspaces/:workspaceId/github/pull-requests/:pullRequestId/files")
  @UseGuards(AuthGuard)
  async listGithubPullRequestFiles(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("pullRequestId") pullRequestId: string,
    @Query() query: ListGithubPullRequestFilesQuery
  ): Promise<ApiSuccessResponseWithMeta<GithubPullRequestFilePayload[]>> {
    const result = await this.githubIntegrationService.listGithubPullRequestFiles(
      currentUserId,
      workspaceId,
      pullRequestId,
      query
    );
    return apiPaginatedResponse(result);
  }

  @Get("workspaces/:workspaceId/github/pull-requests/:pullRequestId/conflict-status")
  @UseGuards(AuthGuard)
  async getGithubPullRequestConflictStatus(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("pullRequestId") pullRequestId: string
  ): Promise<ApiSuccessResponse<GithubPullRequestConflictStatusPayload>> {
    const result =
      await this.githubIntegrationService.getGithubPullRequestConflictStatus(
        currentUserId,
        workspaceId,
        pullRequestId
      );
    return apiResponse(result);
  }
}
