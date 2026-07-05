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
import {
  CurrentMeetingPayload,
  MeetingService,
  PendingMeetingPayload,
  StartMeetingPayload
} from "./meeting.service";

@Controller("workspaces/:workspaceId")
@UseGuards(AuthGuard)
export class MeetingController {
  constructor(private readonly meetingService: MeetingService) {}

  @Get("meetings/current")
  async getCurrentMeeting(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string
  ): Promise<ApiSuccessResponse<CurrentMeetingPayload>> {
    const result = await this.meetingService.getCurrentMeeting(
      currentUserId,
      workspaceId
    );
    return apiResponse(result);
  }

  @Post("meetings")
  async startMeeting(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<StartMeetingPayload>> {
    const result = await this.meetingService.startMeeting(
      currentUserId,
      workspaceId,
      body
    );
    return apiResponse(result);
  }

  @Post("meetings/:meetingId/participants/me")
  async joinMeeting(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("meetingId") meetingId: string
  ): Promise<ApiSuccessResponse<PendingMeetingPayload>> {
    const result = await this.meetingService.joinMeeting(
      currentUserId,
      workspaceId,
      meetingId
    );
    return apiResponse(result);
  }

  @Get("meetings/:meetingId")
  async getMeeting(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("meetingId") meetingId: string
  ): Promise<ApiSuccessResponse<PendingMeetingPayload>> {
    const result = await this.meetingService.getMeeting(
      currentUserId,
      workspaceId,
      meetingId
    );
    return apiResponse(result);
  }

  @Delete("meetings/:meetingId/participants/me")
  async leaveMeeting(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("meetingId") meetingId: string
  ): Promise<ApiSuccessResponse<PendingMeetingPayload>> {
    const result = await this.meetingService.leaveMeeting(
      currentUserId,
      workspaceId,
      meetingId
    );
    return apiResponse(result);
  }

  @Post("meetings/:meetingId/end")
  async endMeeting(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("meetingId") meetingId: string
  ): Promise<ApiSuccessResponse<PendingMeetingPayload>> {
    const result = await this.meetingService.endMeeting(
      currentUserId,
      workspaceId,
      meetingId
    );
    return apiResponse(result);
  }

  @Get("meetings/:meetingId/recording")
  async getRecording(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("meetingId") meetingId: string
  ): Promise<ApiSuccessResponse<PendingMeetingPayload>> {
    const result = await this.meetingService.getRecording(
      currentUserId,
      workspaceId,
      meetingId
    );
    return apiResponse(result);
  }

  @Get("meetings/:meetingId/participants")
  async listParticipants(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("meetingId") meetingId: string
  ): Promise<ApiSuccessResponse<PendingMeetingPayload>> {
    const result = await this.meetingService.listParticipants(
      currentUserId,
      workspaceId,
      meetingId
    );
    return apiResponse(result);
  }

  @Get("meeting-reports")
  async listReports(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Query("status") status: string | undefined,
    @Query("limit") limit: string | undefined
  ): Promise<ApiSuccessResponse<PendingMeetingPayload>> {
    const result = await this.meetingService.listReports(currentUserId, workspaceId, {
      status,
      limit
    });
    return apiResponse(result);
  }

  @Get("meeting-reports/:reportId")
  async getReport(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("reportId") reportId: string
  ): Promise<ApiSuccessResponse<PendingMeetingPayload>> {
    const result = await this.meetingService.getReport(
      currentUserId,
      workspaceId,
      reportId
    );
    return apiResponse(result);
  }

  @Get("meetings/:meetingId/report")
  async getMeetingReport(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("meetingId") meetingId: string
  ): Promise<ApiSuccessResponse<PendingMeetingPayload>> {
    const result = await this.meetingService.getMeetingReport(
      currentUserId,
      workspaceId,
      meetingId
    );
    return apiResponse(result);
  }

  @Post("meeting-reports/:reportId/regeneration-jobs")
  async requestReportRegeneration(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("reportId") reportId: string
  ): Promise<ApiSuccessResponse<PendingMeetingPayload>> {
    const result = await this.meetingService.requestReportRegeneration(
      currentUserId,
      workspaceId,
      reportId
    );
    return apiResponse(result);
  }
}
