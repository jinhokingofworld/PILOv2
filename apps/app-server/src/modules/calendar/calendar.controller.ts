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
  CalendarEventPayload,
  CalendarService,
  DeleteCalendarEventPayload
} from "./calendar.service";

@Controller("workspaces/:workspaceId/calendar/events")
@UseGuards(AuthGuard)
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Get()
  async listEvents(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Query("start") start: string | undefined,
    @Query("end") end: string | undefined
  ): Promise<ApiSuccessResponse<CalendarEventPayload[]>> {
    const events = await this.calendarService.listEvents(currentUserId, workspaceId, {
      start,
      end
    });
    return apiResponse(events);
  }

  @Get(":eventId")
  async getEvent(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("eventId") eventId: string
  ): Promise<ApiSuccessResponse<CalendarEventPayload>> {
    const event = await this.calendarService.getEvent(currentUserId, workspaceId, eventId);
    return apiResponse(event);
  }

  @Post()
  async createEvent(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<CalendarEventPayload>> {
    const event = await this.calendarService.createEvent(
      currentUserId,
      workspaceId,
      body
    );
    return apiResponse(event);
  }

  @Patch(":eventId")
  async updateEvent(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("eventId") eventId: string,
    @Body() body: unknown
  ): Promise<ApiSuccessResponse<CalendarEventPayload>> {
    const event = await this.calendarService.updateEvent(
      currentUserId,
      workspaceId,
      eventId,
      body
    );
    return apiResponse(event);
  }

  @Delete(":eventId")
  async deleteEvent(
    @CurrentUserId() currentUserId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("eventId") eventId: string
  ): Promise<ApiSuccessResponse<DeleteCalendarEventPayload>> {
    const result = await this.calendarService.deleteEvent(
      currentUserId,
      workspaceId,
      eventId
    );
    return apiResponse(result);
  }
}
