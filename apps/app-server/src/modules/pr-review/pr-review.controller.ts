import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UseGuards
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { apiResponse, type ApiSuccessResponse } from "../../common/api-response";
import { AuthGuard } from "../../common/auth.guard";
import { CurrentUserId } from "../../common/current-user.decorator";
import {
  DeletePrReviewSessionPayload,
  DeletePrReviewRoomPayload,
  PrReviewCanvasPayload,
  PrReviewConflictAnalysisPayload,
  PrReviewConflictApplyPayload,
  PrReviewConflictDraftPayload,
  PrReviewConflictsApplyPayload,
  PrReviewConflictSuggestionPayload,
  PrReviewFileDecisionListPayload,
  PrReviewFileDiffPayload,
  PrReviewFilePayload,
  PrReviewFlowFilesPayload,
  PrReviewFlowListPayload,
  PrReviewMergePayload,
  PrReviewResultPayload,
  PrReviewRoomListPayload,
  PrReviewRoomPayload,
  PrReviewRoomRevisionListPayload,
  PrReviewRoomStartPayload,
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

  @Get("pull-requests/:pullRequestId/review-room")
  async getReviewRoomForPullRequest(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("pullRequestId") pullRequestId: string
  ): Promise<ApiSuccessResponse<PrReviewRoomPayload>> {
    const room = await this.prReviewService.getReviewRoomForPullRequest(
      currentUserId,
      workspaceId,
      pullRequestId
    );
    return apiResponse(room);
  }

  @Post("pull-requests/:pullRequestId/review-room")
  async createOrJoinReviewRoom(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("pullRequestId") pullRequestId: string,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<ApiSuccessResponse<PrReviewRoomStartPayload>> {
    const result = await this.prReviewService.createOrJoinReviewRoom(
      currentUserId,
      workspaceId,
      pullRequestId
    );
    reply.status(result.roomCreated || result.revisionCreated ? 201 : 200);
    return apiResponse(result);
  }

  @Get("review-rooms")
  async listReviewRooms(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string
  ): Promise<ApiSuccessResponse<PrReviewRoomListPayload>> {
    const rooms = await this.prReviewService.listReviewRooms(
      currentUserId,
      workspaceId
    );
    return apiResponse(rooms);
  }

  @Get("review-rooms/:reviewRoomId")
  async getReviewRoom(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("reviewRoomId") reviewRoomId: string
  ): Promise<ApiSuccessResponse<PrReviewRoomPayload>> {
    const room = await this.prReviewService.getReviewRoom(
      currentUserId,
      workspaceId,
      reviewRoomId
    );
    return apiResponse(room);
  }

  @Get("review-rooms/:reviewRoomId/revisions")
  async listReviewRoomRevisions(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("reviewRoomId") reviewRoomId: string
  ): Promise<ApiSuccessResponse<PrReviewRoomRevisionListPayload>> {
    const revisions = await this.prReviewService.listReviewRoomRevisions(
      currentUserId,
      workspaceId,
      reviewRoomId
    );
    return apiResponse(revisions);
  }

  @Post("review-rooms/:reviewRoomId/revisions")
  async createReviewRoomRevision(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("reviewRoomId") reviewRoomId: string,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<ApiSuccessResponse<PrReviewRoomStartPayload>> {
    const result = await this.prReviewService.createReviewRoomRevision(
      currentUserId,
      workspaceId,
      reviewRoomId
    );
    reply.status(result.revisionCreated ? 201 : 200);
    return apiResponse(result);
  }

  @Delete("review-rooms/:reviewRoomId")
  async deleteReviewRoom(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("reviewRoomId") reviewRoomId: string
  ): Promise<ApiSuccessResponse<DeletePrReviewRoomPayload>> {
    const result = await this.prReviewService.deleteReviewRoom(
      currentUserId,
      workspaceId,
      reviewRoomId
    );
    return apiResponse(result);
  }

  @Post("pull-requests/:pullRequestId/review-sessions")
  async createReviewSession(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("pullRequestId") pullRequestId: string,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<ApiSuccessResponse<PrReviewSessionPayload>> {
    const result = await this.prReviewService.createReviewSession(
      currentUserId,
      workspaceId,
      pullRequestId
    );

    reply.status(result.created ? 201 : 200);
    return apiResponse(result.session);
  }

  @Post("review-sessions/:reviewSessionId/retry")
  async retryReviewSession(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("reviewSessionId") reviewSessionId: string,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<ApiSuccessResponse<PrReviewSessionPayload>> {
    const session = await this.prReviewService.retryReviewSession(
      currentUserId,
      workspaceId,
      reviewSessionId
    );

    reply.status(201);
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

  @Get("review-sessions/:reviewSessionId/conflicts")
  async getReviewSessionConflicts(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("reviewSessionId") reviewSessionId: string
  ): Promise<ApiSuccessResponse<PrReviewConflictAnalysisPayload>> {
    const conflicts = await this.prReviewService.getReviewSessionConflicts(
      currentUserId,
      workspaceId,
      reviewSessionId
    );
    return apiResponse(conflicts);
  }

  @Post("review-sessions/:reviewSessionId/conflict-apply")
  async applyReviewSessionConflictResolutions(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("reviewSessionId") reviewSessionId: string,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<PrReviewConflictsApplyPayload>> {
    const applyResult =
      await this.prReviewService.applyReviewSessionConflictResolutions(
        currentUserId,
        workspaceId,
        reviewSessionId,
        body
      );
    return apiResponse(applyResult);
  }

  @Post("review-files/:reviewFileId/conflict-suggestion")
  async createReviewFileConflictSuggestion(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("reviewFileId") reviewFileId: string,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<PrReviewConflictSuggestionPayload>> {
    const suggestion =
      await this.prReviewService.createReviewFileConflictSuggestion(
        currentUserId,
        workspaceId,
        reviewFileId,
        body
      );
    return apiResponse(suggestion);
  }

  @Get("review-files/:reviewFileId/conflict-draft")
  async getReviewFileConflictDraft(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("reviewFileId") reviewFileId: string
  ): Promise<ApiSuccessResponse<PrReviewConflictDraftPayload | null>> {
    const draft = await this.prReviewService.getReviewFileConflictDraft(
      currentUserId,
      workspaceId,
      reviewFileId
    );
    return apiResponse(draft);
  }

  @Patch("review-files/:reviewFileId/conflict-draft")
  async updateReviewFileConflictDraft(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("reviewFileId") reviewFileId: string,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<PrReviewConflictDraftPayload>> {
    const draft = await this.prReviewService.updateReviewFileConflictDraft(
      currentUserId,
      workspaceId,
      reviewFileId,
      body
    );
    return apiResponse(draft);
  }

  @Post("review-files/:reviewFileId/conflict-apply")
  async applyReviewFileConflictResolution(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("reviewFileId") reviewFileId: string,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<PrReviewConflictApplyPayload>> {
    const applyResult =
      await this.prReviewService.applyReviewFileConflictResolution(
        currentUserId,
        workspaceId,
        reviewFileId,
        body
      );
    return apiResponse(applyResult);
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

  @Post("review-sessions/:reviewSessionId/merge")
  async mergeReviewSession(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("reviewSessionId") reviewSessionId: string,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<PrReviewMergePayload>> {
    const mergeResult = await this.prReviewService.mergeReviewSession(
      currentUserId,
      workspaceId,
      reviewSessionId,
      body
    );
    return apiResponse(mergeResult);
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
