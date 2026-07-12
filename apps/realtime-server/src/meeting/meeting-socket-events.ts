export const meetingClientEvents = {
  subscribe: "meeting:subscribe",
  unsubscribe: "meeting:unsubscribe"
} as const;

export const meetingServerEvents = {
  error: "meeting:error",
  subscribed: "meeting:subscribed",
  reportUpdated: "meeting:report:updated"
} as const;

export type MeetingReportRealtimeStatus =
  | "PROCESSING"
  | "QUEUED"
  | "TRANSCRIBING"
  | "SUMMARIZING"
  | "COMPLETED"
  | "FAILED";

export type MeetingReportRedisEvent = {
  event: "meeting:report:updated";
  workspaceId: string;
  reportId: string;
  meetingId: string;
  recordingId: string;
  status: MeetingReportRealtimeStatus;
  failedStep: "RECORDING" | "STT" | "LLM" | null;
  updatedAt: string;
};

export function isMeetingReportRedisEvent(
  value: unknown
): value is MeetingReportRedisEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return (
    event.event === "meeting:report:updated" &&
    typeof event.workspaceId === "string" &&
    typeof event.reportId === "string" &&
    typeof event.meetingId === "string" &&
    typeof event.recordingId === "string" &&
    ["PROCESSING", "QUEUED", "TRANSCRIBING", "SUMMARIZING", "COMPLETED", "FAILED"].includes(
      String(event.status)
    ) &&
    (event.failedStep === null || ["RECORDING", "STT", "LLM"].includes(String(event.failedStep))) &&
    typeof event.updatedAt === "string" &&
    Number.isFinite(Date.parse(event.updatedAt))
  );
}
