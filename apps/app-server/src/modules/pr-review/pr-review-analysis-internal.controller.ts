import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { apiResponse, type ApiSuccessResponse } from "../../common/api-response";
import {
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
}
