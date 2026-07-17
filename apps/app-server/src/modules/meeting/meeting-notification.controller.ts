import { Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { apiResponse, type ApiSuccessResponse } from "../../common/api-response";
import { AuthGuard } from "../../common/auth.guard";
import { CurrentUserId } from "../../common/current-user.decorator";
import {
  MeetingNotificationService,
  type MeetingInvitationAcceptancePayload,
  type MeetingNotificationPayload
} from "./meeting-notification.service";

@Controller("me/meeting-notifications")
@UseGuards(AuthGuard)
export class MeetingNotificationController {
  constructor(private readonly meetingNotificationService: MeetingNotificationService) {}

  @Get()
  async list(
    @CurrentUserId() currentUserId: string
  ): Promise<ApiSuccessResponse<{ items: MeetingNotificationPayload[]; unreadCount: number }>> {
    return apiResponse(
      await this.meetingNotificationService.listNotifications(currentUserId)
    );
  }

  @Patch(":notificationId/read")
  async read(
    @CurrentUserId() currentUserId: string,
    @Param("notificationId") notificationId: string
  ): Promise<ApiSuccessResponse<MeetingNotificationPayload>> {
    return apiResponse(
      await this.meetingNotificationService.readNotification(
        currentUserId,
        notificationId
      )
    );
  }
}

@Controller("me/meeting-invitations")
@UseGuards(AuthGuard)
export class CurrentUserMeetingInvitationController {
  constructor(private readonly meetingNotificationService: MeetingNotificationService) {}

  @Post(":invitationId/accept")
  async accept(
    @CurrentUserId() currentUserId: string,
    @Param("invitationId") invitationId: string
  ): Promise<ApiSuccessResponse<MeetingInvitationAcceptancePayload>> {
    return apiResponse(
      await this.meetingNotificationService.acceptInvitation(
        currentUserId,
        invitationId
      )
    );
  }

  @Post(":invitationId/decline")
  async decline(
    @CurrentUserId() currentUserId: string,
    @Param("invitationId") invitationId: string
  ): Promise<ApiSuccessResponse<{ invitationId: string; status: "DECLINED" }>> {
    return apiResponse(
      await this.meetingNotificationService.declineInvitation(
        currentUserId,
        invitationId
      )
    );
  }
}
