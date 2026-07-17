export const meetingClientEvents = {
  subscribe: "meeting:subscribe",
  unsubscribe: "meeting:unsubscribe"
} as const;

export const meetingServerEvents = {
  error: "meeting:error",
  subscribed: "meeting:subscribed",
  reportUpdated: "meeting:report:updated",
  stateUpdated: "meeting:state:updated",
  notificationCreated: "meeting:notification:created",
  notificationUpdated: "meeting:notification:updated"
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

export type MeetingStateChange =
  | "started"
  | "participant_joined"
  | "participant_left"
  | "ended"
  | "recording_started"
  | "recording_ended"
  | "recording_failed";

export type MeetingStateRedisEvent = {
  event: "meeting:state:updated";
  workspaceId: string;
  meetingId: string;
  change: MeetingStateChange;
  updatedAt: string;
};

export type MeetingNotificationRedisEvent = {
  event: "meeting:notification:created" | "meeting:notification:updated";
  notificationId: string;
  recipientUserId: string;
  occurredAt: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

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

export function isMeetingStateRedisEvent(
  value: unknown
): value is MeetingStateRedisEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return (
    event.event === "meeting:state:updated" &&
    isUuid(event.workspaceId) &&
    isUuid(event.meetingId) &&
    [
      "started",
      "participant_joined",
      "participant_left",
      "ended",
      "recording_started",
      "recording_ended",
      "recording_failed"
    ].includes(String(event.change)) &&
    typeof event.updatedAt === "string" &&
    Number.isFinite(Date.parse(event.updatedAt))
  );
}

export function isMeetingNotificationRedisEvent(
  value: unknown
): value is MeetingNotificationRedisEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return (
    (event.event === "meeting:notification:created" ||
      event.event === "meeting:notification:updated") &&
    isUuid(event.notificationId) &&
    isUuid(event.recipientUserId) &&
    typeof event.occurredAt === "string" &&
    Number.isFinite(Date.parse(event.occurredAt))
  );
}
