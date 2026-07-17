import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";

@Injectable()
export class CanvasRecordingActivityGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.REALTIME_CANVAS_ACTIVITY_TOKEN?.trim();
    const provided = context
      .switchToHttp()
      .getRequest<{ headers: { "x-realtime-canvas-activity-token"?: string } }>()
      .headers["x-realtime-canvas-activity-token"]
      ?.trim();

    if (!expected) {
      throw new ServiceUnavailableException("Canvas recording activity delivery is unavailable");
    }
    if (!provided) throw new UnauthorizedException("Invalid Canvas recording activity token");

    const actual = Buffer.from(provided);
    const expectedBuffer = Buffer.from(expected);
    if (actual.length !== expectedBuffer.length || !timingSafeEqual(actual, expectedBuffer)) {
      throw new UnauthorizedException("Invalid Canvas recording activity token");
    }

    return true;
  }
}
