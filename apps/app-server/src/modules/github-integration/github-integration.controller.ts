import { Body, Controller, Delete, Get, Post, Query, UseGuards } from "@nestjs/common";
import { apiResponse, ApiSuccessResponse } from "../../common/api-response";
import { AuthGuard } from "../../common/auth.guard";
import { CurrentUserId } from "../../common/current-user.decorator";
import type { GithubOAuthCallbackQuery, StartGithubOAuthRequest } from "./dto";
import { GithubIntegrationService } from "./github-integration.service";
import type {
  GithubOAuthCallbackPayload,
  GithubOAuthDisconnectPayload,
  GithubOAuthStartPayload,
  GithubOAuthStatusPayload
} from "./types";

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
}
