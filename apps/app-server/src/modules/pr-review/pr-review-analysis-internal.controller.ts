import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { apiResponse, type ApiSuccessResponse } from "../../common/api-response";
import {
  PrReviewAnalysisJobCompletionPayload,
  PrReviewAnalysisInputPayload,
  PrReviewService
} from "./pr-review.service";
import { PrReviewAnalysisHandoffGuard } from "./pr-review-analysis-handoff.guard";

@Controller("internal/pr-review")
@UseGuards(PrReviewAnalysisHandoffGuard)
export class PrReviewAnalysisInternalController {
  constructor(private readonly prReviewService: PrReviewService) {}

  @Get("analysis-jobs/:jobId/input")
  async getAnalysisInput(
    @Param("jobId") jobId: string
  ): Promise<ApiSuccessResponse<PrReviewAnalysisInputPayload>> {
    return apiResponse(await this.prReviewService.getAnalysisJobInput(jobId));
  }

  @Post("analysis-jobs/:jobId/result")
  async storeAnalysisResult(
    @Param("jobId") jobId: string,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<PrReviewAnalysisJobCompletionPayload>> {
    return apiResponse(await this.prReviewService.storeAnalysisJobResult(jobId, body));
  }

  @Post("analysis-jobs/:jobId/failure")
  async storeAnalysisFailure(
    @Param("jobId") jobId: string,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<PrReviewAnalysisJobCompletionPayload>> {
    return apiResponse(await this.prReviewService.storeAnalysisJobFailure(jobId, body));
  }
}
