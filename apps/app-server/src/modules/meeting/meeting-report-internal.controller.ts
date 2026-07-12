import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards
} from "@nestjs/common";
import { MeetingReportEventGuard } from "./meeting-report-event.guard";
import { MeetingReportRealtimePublisherService } from "./meeting-report-realtime-publisher.service";

@Controller("internal/meeting-reports")
@UseGuards(MeetingReportEventGuard)
export class MeetingReportInternalController {
  constructor(private readonly publisher: MeetingReportRealtimePublisherService) {}

  @Post("events")
  @HttpCode(HttpStatus.NO_CONTENT)
  async publish(@Body() body: { reportId?: unknown }): Promise<void> {
    if (typeof body.reportId !== "string" || !body.reportId.trim()) {
      throw new BadRequestException("reportId is required");
    }
    await this.publisher.publishReportUpdatedSafely(body.reportId.trim());
  }
}
