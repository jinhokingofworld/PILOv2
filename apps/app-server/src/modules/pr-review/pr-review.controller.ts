import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { apiResponse, type ApiSuccessResponse } from "../../common/api-response";
import { AuthGuard } from "../../common/auth.guard";
import { CurrentUserId } from "../../common/current-user.decorator";
import {
  DeletePrReviewSessionPayload,
  PrReviewCanvasPayload,
  PrReviewFileDecisionListPayload,
  PrReviewFileDiffPayload,
  PrReviewFilePayload,
  PrReviewFlowFilesPayload,
  PrReviewFlowListPayload,
  PrReviewResultPayload,
  PrReviewService,
  PrReviewSubmissionListPayload,
  PrReviewSubmissionPayload,
  PrReviewSummaryPayload,
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

  @Get("review-sessions/:reviewSessionId/summary")
  async getReviewSessionSummary(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("reviewSessionId") reviewSessionId: string
  ): Promise<ApiSuccessResponse<PrReviewSummaryPayload>> {
    const summary = await this.prReviewService.getReviewSessionSummary(
      currentUserId,
      workspaceId,
      reviewSessionId
    );
    return apiResponse(summary);
  }

  @Get("review-sessions/:reviewSessionId/result")
  async getReviewSessionResult(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("reviewSessionId") reviewSessionId: string
  ): Promise<ApiSuccessResponse<PrReviewResultPayload>> {
    const result = await this.prReviewService.getReviewSessionResult(
      currentUserId,
      workspaceId,
      reviewSessionId
    );
    return apiResponse(result);
  }

  @Get("review-sessions/:reviewSessionId/canvas")
  async getReviewSessionCanvas(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("reviewSessionId") reviewSessionId: string
  ): Promise<ApiSuccessResponse<PrReviewCanvasPayload>> {
    const canvas = await this.prReviewService.getReviewSessionCanvas(
      currentUserId,
      workspaceId,
      reviewSessionId
    );
    return apiResponse(canvas);
  }

  @Get("review-sessions/:reviewSessionId/flows")
  async listReviewFlows(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("reviewSessionId") reviewSessionId: string
  ): Promise<ApiSuccessResponse<PrReviewFlowListPayload>> {
    const flows = await this.prReviewService.listReviewFlows(
      currentUserId,
      workspaceId,
      reviewSessionId
    );
    return apiResponse(flows);
  }

  @Get("review-flows/:flowId/files")
  async listReviewFlowFiles(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("flowId") flowId: string
  ): Promise<ApiSuccessResponse<PrReviewFlowFilesPayload>> {
    const files = await this.prReviewService.listReviewFlowFiles(
      currentUserId,
      workspaceId,
      flowId
    );
    return apiResponse(files);
  }

  @Get("review-files/:reviewFileId")
  async getReviewFile(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("reviewFileId") reviewFileId: string
  ): Promise<ApiSuccessResponse<PrReviewFilePayload>> {
    const file = await this.prReviewService.getReviewFile(
      currentUserId,
      workspaceId,
      reviewFileId
    );
    return apiResponse(file);
  }

  @Patch("review-files/:reviewFileId/review")
  async updateReviewFileDecision(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("reviewFileId") reviewFileId: string,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<PrReviewFilePayload>> {
    const file = await this.prReviewService.updateReviewFileDecision(
      currentUserId,
      workspaceId,
      reviewFileId,
      body
    );
    return apiResponse(file);
  }

  @Get("review-files/:reviewFileId/decisions")
  async listReviewFileDecisions(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("reviewFileId") reviewFileId: string
  ): Promise<ApiSuccessResponse<PrReviewFileDecisionListPayload>> {
    const decisions = await this.prReviewService.listReviewFileDecisions(
      currentUserId,
      workspaceId,
      reviewFileId
    );
    return apiResponse(decisions);
  }

  @Get("review-files/:reviewFileId/diff")
  async getReviewFileDiff(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("reviewFileId") reviewFileId: string
  ): Promise<ApiSuccessResponse<PrReviewFileDiffPayload>> {
    const diff = await this.prReviewService.getReviewFileDiff(
      currentUserId,
      workspaceId,
      reviewFileId
    );
    return apiResponse(diff);
  }

  @Post("review-sessions/:reviewSessionId/submissions")
  async submitReviewSession(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("reviewSessionId") reviewSessionId: string,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<PrReviewSubmissionPayload>> {
    const submission = await this.prReviewService.submitReviewSession(
      currentUserId,
      workspaceId,
      reviewSessionId,
      body
    );
    return apiResponse(submission);
  }

  @Get("review-sessions/:reviewSessionId/submissions")
  async listReviewSubmissions(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("reviewSessionId") reviewSessionId: string
  ): Promise<ApiSuccessResponse<PrReviewSubmissionListPayload>> {
    const submissions = await this.prReviewService.listReviewSubmissions(
      currentUserId,
      workspaceId,
      reviewSessionId
    );
    return apiResponse(submissions);
  }

  @Get("review-submissions/:submissionId")
  async getReviewSubmission(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("submissionId") submissionId: string
  ): Promise<ApiSuccessResponse<PrReviewSubmissionPayload>> {
    const submission = await this.prReviewService.getReviewSubmission(
      currentUserId,
      workspaceId,
      submissionId
    );
    return apiResponse(submission);
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
