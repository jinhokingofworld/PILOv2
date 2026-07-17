import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { apiResponse, ApiSuccessResponse } from "../../common/api-response";
import { AuthGuard } from "../../common/auth.guard";
import { CurrentUserId } from "../../common/current-user.decorator";
import { CalendarService } from "./calendar.service";
import { GoogleCalendarConnectionPayload, GoogleCalendarItemPayload, GoogleCalendarSyncService } from "./google-calendar-sync.service";

@Controller("calendar/google")
export class GoogleCalendarController {
  constructor(private readonly syncService: GoogleCalendarSyncService) {}

  @Get("connection")
  @UseGuards(AuthGuard)
  async connection(@CurrentUserId() userId: string): Promise<ApiSuccessResponse<GoogleCalendarConnectionPayload>> {
    return apiResponse(await this.syncService.getConnection(userId));
  }

  @Post("connection/start")
  @UseGuards(AuthGuard)
  async start(@CurrentUserId() userId: string, @Body() body: unknown): Promise<ApiSuccessResponse<{ authorizeUrl: string }>> {
    return apiResponse(await this.syncService.startConnection(userId, body));
  }

  @Get("callback")
  async callback(@Query() query: { code?: string; state?: string; error?: string }, @Res() reply: FastifyReply): Promise<void> {
    try {
      const returnPath = await this.syncService.completeConnection(query);
      const redirect = new URL(returnPath, process.env.FRONTEND_URL ?? "http://localhost:3000");
      redirect.searchParams.set("googleCalendarConnected", "1");
      void reply.status(302).redirect(redirect.toString());
    } catch {
      const redirect = new URL("/calendar", process.env.FRONTEND_URL ?? "http://localhost:3000");
      redirect.searchParams.set("googleCalendarError", "connection_failed");
      void reply.status(302).redirect(redirect.toString());
    }
  }

  @Get("calendars")
  @UseGuards(AuthGuard)
  async calendars(@CurrentUserId() userId: string): Promise<ApiSuccessResponse<GoogleCalendarItemPayload[]>> {
    return apiResponse(await this.syncService.listCalendars(userId));
  }

  @Put("target")
  @UseGuards(AuthGuard)
  async selectTarget(@CurrentUserId() userId: string, @Body() body: unknown): Promise<ApiSuccessResponse<GoogleCalendarConnectionPayload>> {
    return apiResponse(await this.syncService.selectTargetCalendar(userId, body));
  }

  @Delete("connection")
  @UseGuards(AuthGuard)
  async disconnect(@CurrentUserId() userId: string): Promise<ApiSuccessResponse<{ disconnected: true }>> {
    await this.syncService.disconnect(userId);
    return apiResponse({ disconnected: true });
  }
}

@Controller("workspaces/:workspaceId/calendar/events")
@UseGuards(AuthGuard)
export class CalendarGoogleEventController {
  constructor(private readonly calendarService: CalendarService, private readonly syncService: GoogleCalendarSyncService) {}

  @Post(":eventId/google-sync")
  async enable(@CurrentUserId() userId: string, @Param("workspaceId") workspaceId: string, @Param("eventId") eventId: string): Promise<ApiSuccessResponse<{ queued: true }>> {
    const event = await this.calendarService.getEvent(userId, workspaceId, eventId);
    await this.syncService.enableEventSync(userId, workspaceId, event);
    return apiResponse({ queued: true });
  }

  @Post(":eventId/google-sync/retry")
  async retry(@CurrentUserId() userId: string, @Param("workspaceId") workspaceId: string, @Param("eventId") eventId: string): Promise<ApiSuccessResponse<{ queued: true }>> {
    const event = await this.calendarService.getEvent(userId, workspaceId, eventId);
    await this.syncService.retryEventSync(userId, workspaceId, event);
    return apiResponse({ queued: true });
  }
}
