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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller("internal/meeting-reports")
@UseGuards(MeetingReportEventGuard)
export class MeetingReportInternalController {
  constructor(private readonly publisher: MeetingReportRealtimePublisherService) {}

  @Post("events")
  @HttpCode(HttpStatus.NO_CONTENT)
  async publish(@Body() body: { reportId?: unknown }): Promise<void> {
    const reportId = typeof body.reportId === "string" ? body.reportId.trim() : "";
    if (!reportId) {
      throw new BadRequestException("reportId is required");
    }
    if (!UUID_PATTERN.test(reportId)) {
      throw new BadRequestException("reportId must be a UUID");
    }
    await this.publisher.publishReportUpdatedSafely(reportId);
  }
}
