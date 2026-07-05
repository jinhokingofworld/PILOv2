import { Body, Controller, Get, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { apiResponse, ApiSuccessResponse } from "../../common/api-response";
import { AuthGuard, AuthenticatedRequest } from "../../common/auth.guard";
import { AuthService } from "./auth.service";
import type {
  LoginCallbackQuery,
  LoginProvider,
  LoginStartPayload,
  LogoutPayload,
  StartLoginRequest
} from "./types";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("google/start")
  startGoogleLogin(
    @Body() body: StartLoginRequest | undefined
  ): ApiSuccessResponse<LoginStartPayload> {
    return apiResponse(this.authService.startLogin("google", body));
  }

  @Post("github/start")
  startGithubLogin(
    @Body() body: StartLoginRequest | undefined
  ): ApiSuccessResponse<LoginStartPayload> {
    return apiResponse(this.authService.startLogin("github", body));
  }

  @Get("google/callback")
  async completeGoogleLogin(
    @Query() query: LoginCallbackQuery,
    @Res() reply: FastifyReply
  ): Promise<void> {
    await this.redirectLoginCallback("google", query, reply);
  }

  @Get("github/callback")
  async completeGithubLogin(
    @Query() query: LoginCallbackQuery,
    @Res() reply: FastifyReply
  ): Promise<void> {
    await this.redirectLoginCallback("github", query, reply);
  }

  @Post("logout")
  @UseGuards(AuthGuard)
  async logout(
    @Req() request: AuthenticatedRequest
  ): Promise<ApiSuccessResponse<LogoutPayload>> {
    const accessToken = this.authService.extractBearerToken(request.headers.authorization);
    await this.authService.logout(accessToken);

    return apiResponse({
      loggedOut: true
    });
  }

  private async redirectLoginCallback(
    provider: LoginProvider,
    query: LoginCallbackQuery,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const redirectUrl = await this.authService.completeLoginCallback(provider, query);
      void reply.redirect(redirectUrl);
    } catch {
      void reply.redirect(this.authService.buildLoginRedirect(`${provider}_login_failed`));
    }
  }
}
