import { Injectable } from "@nestjs/common";

export interface MeetingReportJobPayload {
  jobType: "meeting_report";
  reportId: string;
  meetingId: string;
  recordingId: string;
  audioFileKey: string;
  retryCount: number;
}

@Injectable()
export class MeetingReportJobService {
  async enqueueMeetingReportJob(_payload: MeetingReportJobPayload): Promise<void> {
    // Actual SQS publish is intentionally split into issue #173.
  }
}
