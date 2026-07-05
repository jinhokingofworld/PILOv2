import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { apiResponse, type ApiSuccessResponse } from "../../common/api-response";
import { AuthGuard } from "../../common/auth.guard";
import { CurrentUserId } from "../../common/current-user.decorator";
import {
  DeletePrReviewSessionPayload,
  PrReviewService,
  PrReviewSessionPayload
} from "./pr-review.service";

@Controller("workspaces/:workspaceId/github")
@UseGuards(AuthGuard)
export class PrReviewController {
  constructor(private readonly prReviewService: PrReviewService) {}

  @Post("pull-requests/:pullRequestId/review-sessions")
  async createReviewSession(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("pullRequestId") pullRequestId: string
  ): Promise<ApiSuccessResponse<PrReviewSessionPayload>> {
    const session = await this.prReviewService.createReviewSession(
      currentUserId,
      workspaceId,
      pullRequestId
    );
    return apiResponse(session);
  }

  @Get("review-sessions/:reviewSessionId")
  async getReviewSession(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("reviewSessionId") reviewSessionId: string
  ): Promise<ApiSuccessResponse<PrReviewSessionPayload>> {
    const session = await this.prReviewService.getReviewSession(
      currentUserId,
      workspaceId,
      reviewSessionId
    );
    return apiResponse(session);
  }

  @Patch("review-sessions/:reviewSessionId")
  async updateReviewSession(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("reviewSessionId") reviewSessionId: string,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<PrReviewSessionPayload>> {
    const session = await this.prReviewService.updateReviewSession(
      currentUserId,
      workspaceId,
      reviewSessionId,
      body
    );
    return apiResponse(session);
  }

  @Delete("review-sessions/:reviewSessionId")
  async deleteReviewSession(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("reviewSessionId") reviewSessionId: string
  ): Promise<ApiSuccessResponse<DeletePrReviewSessionPayload>> {
    const result = await this.prReviewService.deleteReviewSession(
      currentUserId,
      workspaceId,
      reviewSessionId
    );
    return apiResponse(result);
  }
}
