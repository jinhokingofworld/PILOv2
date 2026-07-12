import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";

@Injectable()
export class MeetingReportEventGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.MEETING_REPORT_EVENT_TOKEN?.trim();
    const provided = context
      .switchToHttp()
      .getRequest<{ headers: { "x-meeting-report-event-token"?: string } }>()
      .headers["x-meeting-report-event-token"]
      ?.trim();
    if (!expected) {
      throw new ServiceUnavailableException("MeetingReport event delivery is unavailable");
    }
    if (!provided) throw new UnauthorizedException("Invalid MeetingReport event token");
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException("Invalid MeetingReport event token");
    }
    return true;
  }
}
