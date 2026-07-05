import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards
} from "@nestjs/common";
import { apiResponse, ApiSuccessResponse } from "../../common/api-response";
import { AuthGuard } from "../../common/auth.guard";
import { CurrentUserId } from "../../common/current-user.decorator";
import type {
  GithubAppInstallationCallbackQuery,
  GithubOAuthCallbackQuery,
  ListGithubPullRequestFilesQuery,
  ListGithubPullRequestsQuery,
  ListGithubProjectsV2Query,
  ListGithubRepositoriesQuery,
  StartGithubAppInstallationRequest,
  StartGithubOAuthRequest
} from "./dto";
import { GithubIntegrationService } from "./github-integration.service";
import type {
  GithubAppInstallationCallbackPayload,
  GithubAppInstallationPayload,
  GithubAppInstallationStartPayload,
  GithubIssuePayload,
  GithubOAuthCallbackPayload,
  GithubOAuthDisconnectPayload,
  GithubOAuthStartPayload,
  GithubOAuthStatusPayload,
  GithubPaginatedPayload,
  GithubPaginationMeta,
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
  GithubRepositoryDetailPayload,
  GithubRepositoryListItemPayload
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
  startGithubOAuth(
    @CurrentUserId() currentUserId: string,
    @Body() body: StartGithubOAuthRequest | undefined
  ): ApiSuccessResponse<GithubOAuthStartPayload> {
    const start = this.githubIntegrationService.startGithubOAuth(currentUserId, body);
    return apiResponse(start);
  }

  @Get("github/oauth/callback")
  async completeGithubOAuthCallback(
    @Query() query: GithubOAuthCallbackQuery
  ): Promise<ApiSuccessResponse<GithubOAuthCallbackPayload>> {
    const result = await this.githubIntegrationService.completeGithubOAuthCallback(
      query
    );
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

  @Post("workspaces/:workspaceId/github/installations/start")
  @UseGuards(AuthGuard)
  async startGithubAppInstallation(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Body() body: StartGithubAppInstallationRequest | undefined
  ): Promise<ApiSuccessResponse<GithubAppInstallationStartPayload>> {
    const result = await this.githubIntegrationService.startGithubAppInstallation(
      currentUserId,
      workspaceId,
      body
    );
    return apiResponse(result);
  }

  @Get("github/installations/callback")
  async completeGithubAppInstallationCallback(
    @Query() query: GithubAppInstallationCallbackQuery
  ): Promise<ApiSuccessResponse<GithubAppInstallationCallbackPayload>> {
    const result =
      await this.githubIntegrationService.completeGithubAppInstallationCallback(query);
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
