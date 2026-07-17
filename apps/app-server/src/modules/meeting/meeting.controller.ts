import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
  DeleteMeetingRoomPayload,
  EndRecordingPayload,
  JoinMeetingPayload,
  LeaveMeetingPayload,
  MeetingDetailPayload,
  MeetingRoomListPayload,
  MeetingRoomMutationPayload,
  MeetingReportDetailResponsePayload,
  MeetingReportDeletionPayload,
  MeetingReportActionItemMutationPayload,
  MeetingReportActionItemExtractionRetryPayload,
  MeetingReportListPayload,
  MeetingReportRegenerationPayload,
  MeetingService,
  ParticipantListPayload,
  RecordingListPayload,
  StartRecordingPayload,
  StartMeetingPayload
} from "./meeting.service";
import {
  MeetingActionItemDeliveryOptionsPayload,
  MeetingActionItemDeliveryPayload,
  MeetingActionItemDeliveryService
} from "./meeting-action-item-delivery.service";

@Controller("workspaces/:workspaceId")
@UseGuards(AuthGuard)
export class MeetingController {
  constructor(
    private readonly meetingService: MeetingService,
    private readonly meetingActionItemDeliveryService: MeetingActionItemDeliveryService
  ) {}

  @Get("meeting-rooms")
  async listMeetingRooms(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string
  ): Promise<ApiSuccessResponse<MeetingRoomListPayload>> {
    return apiResponse(
      await this.meetingService.listMeetingRooms(currentUserId, workspaceId)
    );
  }

  @Post("meeting-rooms")
  async createMeetingRoom(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<MeetingRoomMutationPayload>> {
    return apiResponse(
      await this.meetingService.createMeetingRoom(currentUserId, workspaceId, body)
    );
  }

  @Patch("meeting-rooms/:meetingRoomId")
  async updateMeetingRoom(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("meetingRoomId") meetingRoomId: string,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<MeetingRoomMutationPayload>> {
    return apiResponse(
      await this.meetingService.updateMeetingRoom(
        currentUserId,
        workspaceId,
        meetingRoomId,
        body
      )
    );
  }

  @Delete("meeting-rooms/:meetingRoomId")
  async deleteMeetingRoom(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("meetingRoomId") meetingRoomId: string
  ): Promise<ApiSuccessResponse<DeleteMeetingRoomPayload>> {
    return apiResponse(
      await this.meetingService.deleteMeetingRoom(
        currentUserId,
        workspaceId,
        meetingRoomId
      )
    );
  }

  @Get("meeting-rooms/:meetingRoomId/current")
  async getCurrentMeetingForRoom(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("meetingRoomId") meetingRoomId: string
  ): Promise<ApiSuccessResponse<CurrentMeetingPayload>> {
    return apiResponse(
      await this.meetingService.getCurrentMeetingForRoom(
        currentUserId,
        workspaceId,
        meetingRoomId
      )
    );
  }

  @Post("meeting-rooms/:meetingRoomId/meetings")
  async startMeetingInRoom(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("meetingRoomId") meetingRoomId: string,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<StartMeetingPayload>> {
    return apiResponse(
      await this.meetingService.startMeetingInRoom(
        currentUserId,
        workspaceId,
        meetingRoomId,
        body
      )
    );
  }

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
    @Param("meetingId") meetingId: string,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<JoinMeetingPayload>> {
    const result = await this.meetingService.joinMeeting(
      currentUserId,
      workspaceId,
      meetingId,
      body
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
    @Query("cursor") cursor: unknown,
    @Query("from") from: unknown,
    @Query("q") q: unknown,
    @Query("status") status: unknown,
    @Query("to") to: unknown,
    @Query("limit") limit: unknown
  ): Promise<ApiSuccessResponse<MeetingReportListPayload>> {
    const result = await this.meetingService.listReports(currentUserId, workspaceId, {
      cursor,
      from,
      q,
      status,
      to,
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

  @Delete("meeting-reports/:reportId")
  async deleteReport(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("reportId") reportId: string
  ): Promise<ApiSuccessResponse<MeetingReportDeletionPayload>> {
    return apiResponse(
      await this.meetingService.deleteReport(currentUserId, workspaceId, reportId)
    );
  }

  @Patch("meeting-reports/:reportId/action-items/:actionItemId")
  async updateReportActionItem(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("reportId") reportId: string,
    @Param("actionItemId") actionItemId: string,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<MeetingReportActionItemMutationPayload>> {
    return apiResponse(
      await this.meetingService.updateMeetingReportActionItem(
        currentUserId,
        workspaceId,
        reportId,
        actionItemId,
        body
      )
    );
  }

  @Post("meeting-reports/:reportId/action-items/:actionItemId/approve")
  async approveReportActionItem(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("reportId") reportId: string,
    @Param("actionItemId") actionItemId: string
  ): Promise<ApiSuccessResponse<MeetingReportActionItemMutationPayload>> {
    return apiResponse(
      await this.meetingService.approveMeetingReportActionItem(
        currentUserId,
        workspaceId,
        reportId,
        actionItemId
      )
    );
  }

  @Get("meeting-reports/:reportId/action-items/:actionItemId/delivery-options")
  async getReportActionItemDeliveryOptions(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("reportId") reportId: string,
    @Param("actionItemId") actionItemId: string
  ): Promise<ApiSuccessResponse<MeetingActionItemDeliveryOptionsPayload>> {
    return apiResponse(
      await this.meetingActionItemDeliveryService.listIssueDeliveryOptions(
        currentUserId,
        workspaceId,
        reportId,
        actionItemId
      )
    );
  }

  @Post("meeting-reports/:reportId/action-items/:actionItemId/deliveries")
  async deliverReportActionItem(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("reportId") reportId: string,
    @Param("actionItemId") actionItemId: string,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<MeetingActionItemDeliveryPayload>> {
    return apiResponse(
      await this.meetingActionItemDeliveryService.deliver(
        currentUserId,
        workspaceId,
        reportId,
        actionItemId,
        body
      )
    );
  }

  @Post("meeting-reports/:reportId/action-items/:actionItemId/dismiss")
  async dismissReportActionItem(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("reportId") reportId: string,
    @Param("actionItemId") actionItemId: string
  ): Promise<ApiSuccessResponse<MeetingReportActionItemMutationPayload>> {
    return apiResponse(
      await this.meetingService.dismissMeetingReportActionItem(
        currentUserId,
        workspaceId,
        reportId,
        actionItemId
      )
    );
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
  ): Promise<ApiSuccessResponse<MeetingReportRegenerationPayload>> {
    const result = await this.meetingService.requestReportRegeneration(
      currentUserId,
      workspaceId,
      reportId
    );
    return apiResponse(result);
  }

  @Post("meeting-reports/:reportId/action-item-extractions/retry")
  async retryReportActionItemExtraction(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("reportId") reportId: string
  ): Promise<ApiSuccessResponse<MeetingReportActionItemExtractionRetryPayload>> {
    return apiResponse(
      await this.meetingService.retryMeetingReportActionItemExtraction(
        currentUserId,
        workspaceId,
        reportId
      )
    );
  }
}
