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
  CurrentRecordingPayload,
  CurrentMeetingPayload,
  EndRecordingPayload,
  JoinMeetingPayload,
  LeaveMeetingPayload,
  MeetingDetailPayload,
  MeetingReportDetailResponsePayload,
  MeetingReportListPayload,
  MeetingService,
  ParticipantListPayload,
  PendingMeetingPayload,
  RecordingListPayload,
  StartRecordingPayload,
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
  ): Promise<ApiSuccessResponse<JoinMeetingPayload>> {
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
  ): Promise<ApiSuccessResponse<MeetingDetailPayload>> {
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
  ): Promise<ApiSuccessResponse<LeaveMeetingPayload>> {
    const result = await this.meetingService.leaveMeeting(
      currentUserId,
      workspaceId,
      meetingId
    );
    return apiResponse(result);
  }

  @Post("meetings/:meetingId/recordings")
  async startRecording(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("meetingId") meetingId: string
  ): Promise<ApiSuccessResponse<StartRecordingPayload>> {
    const result = await this.meetingService.startRecording(
      currentUserId,
      workspaceId,
      meetingId
    );
    return apiResponse(result);
  }

  @Post("meetings/:meetingId/recordings/:recordingId/end")
  async endRecordingAndCreateReport(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("meetingId") meetingId: string,
    @Param("recordingId") recordingId: string
  ): Promise<ApiSuccessResponse<EndRecordingPayload>> {
    const result = await this.meetingService.endRecordingAndCreateReport(
      currentUserId,
      workspaceId,
      meetingId,
      recordingId
    );
    return apiResponse(result);
  }

  @Get("meetings/:meetingId/recordings")
  async listRecordings(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("meetingId") meetingId: string
  ): Promise<ApiSuccessResponse<RecordingListPayload>> {
    const result = await this.meetingService.listRecordings(
      currentUserId,
      workspaceId,
      meetingId
    );
    return apiResponse(result);
  }

  @Get("meetings/:meetingId/recordings/current")
  async getCurrentRecording(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("meetingId") meetingId: string
  ): Promise<ApiSuccessResponse<CurrentRecordingPayload>> {
    const result = await this.meetingService.getCurrentRecording(
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
  ): Promise<ApiSuccessResponse<ParticipantListPayload>> {
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
    @Query("status") status: unknown,
    @Query("limit") limit: unknown
  ): Promise<ApiSuccessResponse<MeetingReportListPayload>> {
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
  ): Promise<ApiSuccessResponse<MeetingReportDetailResponsePayload>> {
    const result = await this.meetingService.getReport(
      currentUserId,
      workspaceId,
      reportId
    );
    return apiResponse(result);
  }

  @Get("meetings/:meetingId/reports")
  async listMeetingReports(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("meetingId") meetingId: string
  ): Promise<ApiSuccessResponse<MeetingReportListPayload>> {
    const result = await this.meetingService.listMeetingReports(
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
