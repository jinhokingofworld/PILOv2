import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards
} from "@nestjs/common";
import { CanvasRecordingActivityGuard } from "./canvas-recording-activity.guard";
import { CanvasRecordingActivityService } from "./canvas-recording-activity.service";

@Controller("internal/canvas/recording-activities")
@UseGuards(CanvasRecordingActivityGuard)
export class CanvasRecordingActivityController {
  constructor(private readonly service: CanvasRecordingActivityService) {}

  @Post("batch")
  @HttpCode(HttpStatus.NO_CONTENT)
  async appendBatch(@Body() body: { activities?: unknown }): Promise<void> {
    await this.service.appendBatch(body);
  }
}
