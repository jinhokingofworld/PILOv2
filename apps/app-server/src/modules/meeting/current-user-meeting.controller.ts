import { Controller, Get, UseGuards } from "@nestjs/common";
import { apiResponse, ApiSuccessResponse } from "../../common/api-response";
import { AuthGuard } from "../../common/auth.guard";
import { CurrentUserId } from "../../common/current-user.decorator";
import {
  CurrentUserActiveMeetingPayload,
  MeetingService
} from "./meeting.service";

@Controller("me/meetings")
@UseGuards(AuthGuard)
export class CurrentUserMeetingController {
  constructor(private readonly meetingService: MeetingService) {}

  @Get("active")
  async getActiveMeeting(
    @CurrentUserId() currentUserId: string
  ): Promise<ApiSuccessResponse<CurrentUserActiveMeetingPayload>> {
    return apiResponse(
      await this.meetingService.getCurrentUserActiveMeeting(currentUserId)
    );
  }
}
