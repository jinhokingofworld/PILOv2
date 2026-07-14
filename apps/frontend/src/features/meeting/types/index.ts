export const MAIN_MEETING_ROOM = "MAIN_MEETING_ROOM" as const;

export type MeetingRoomKey = typeof MAIN_MEETING_ROOM;
export type RecordingStatus = "RUNNING" | "COMPLETED" | "FAILED";
export type MeetingReportStatus =
  | "PROCESSING"
  | "QUEUED"
  | "TRANSCRIBING"
  | "SUMMARIZING"
  | "COMPLETED"
  | "FAILED";
export type MeetingReportFailedStep = "RECORDING" | "STT" | "LLM";

export type Meeting = {
  id: string;
  workspaceId: string;
  roomKey: string;
  livekitRoomName: string;
  createdById: string;
  endedById: string | null;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MeetingRoom = {
  id: string;
  workspaceId: string;
  roomKey: string;
  name: string;
  isDefault: boolean;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MeetingParticipantUser = {
  id: string;
  name: string | null;
  avatarUrl: string | null;
};

export type MeetingParticipant = {
  id: string;
  meetingId: string;
  userId: string;
  livekitIdentity: string;
  joinedAt: string;
  leftAt: string | null;
  isActive: boolean;
  user: MeetingParticipantUser;
};

export type LiveKitJoin = {
  livekitRoomName: string;
  livekitIdentity: string;
  livekitToken: string;
  livekitUrl: string;
  expiresAt: string;
};

export type MeetingRecording = {
  id: string;
  meetingId: string;
  status: RecordingStatus;
  audioFileUrl: string | null;
  audioFileKey: string | null;
  durationSec: number | null;
  fileSizeBytes: number | null;
  startedAt: string;
  endedAt: string | null;
  errorMessage: string | null;
};

export type MeetingReportSummary = {
  id: string;
  meetingId: string;
  recordingId: string;
  status: MeetingReportStatus;
  failedStep: MeetingReportFailedStep | null;
  errorMessage: string | null;
  summary: string | null;
  discussionPoints: string | null;
  decisions: string | null;
  actionItemCandidates: unknown[];
  retryCount: number;
  participantSummary?: {
    totalCount: number;
    participants: Array<{ userId: string; name: string | null; avatarUrl: string | null }>;
    hasMore: boolean;
  };
  createdAt: string;
  updatedAt: string;
};

export type MeetingReportDetail = MeetingReportSummary & {
  transcriptText: string | null;
  transcriptSegments?: Array<{ id: string; segmentIndex: number; startedAtMs: number; endedAtMs: number; text: string }>;
  evidence?: Array<{ sourceType: string; sourceIndex: number; transcriptSegmentId: string }>;
  actionItems?: MeetingReportActionItem[];
  actionItemAssignees?: MeetingReportActionItemAssignee[];
};

export type MeetingReportActionItemStatus = "PENDING" | "APPROVED" | "DISMISSED";

export type MeetingReportActionItemAssignee = {
  userId: string;
  name: string | null;
  avatarUrl: string | null;
};

export type MeetingReportActionItem = {
  id: string;
  sourceIndex: number;
  title: string;
  description: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  assignee: MeetingReportActionItemAssignee | null;
  status: MeetingReportActionItemStatus;
  updatedByUserId: string | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
  dismissedByUserId: string | null;
  dismissedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UpdateMeetingReportActionItemInput = {
  title?: string;
  description?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH";
  assigneeUserId?: string | null;
};

export type CurrentMeetingPayload = {
  meeting: Meeting | null;
  currentRecording: MeetingRecording | null;
  activeParticipantCount: number;
};

export type MeetingRoomListPayload = {
  rooms: MeetingRoom[];
};

export type StartMeetingInput = {
  roomKey?: MeetingRoomKey;
  recordingConsent?: RecordingConsentInput;
};

export type RecordingConsentInput = {
  accepted: true;
  policyVersion: "v1";
};

export type JoinMeetingInput = {
  recordingConsent?: RecordingConsentInput;
};

export type StartMeetingPayload = {
  meeting: Meeting;
  participant: MeetingParticipant;
  livekit: LiveKitJoin;
  currentRecording: null;
};

export type JoinMeetingPayload = {
  meeting: Meeting;
  participant: MeetingParticipant;
  livekit: LiveKitJoin;
  currentRecording: MeetingRecording | null;
};

export type MeetingDetailPayload = {
  meeting: Meeting;
  currentRecording: MeetingRecording | null;
  recordings: MeetingRecording[];
  reports: MeetingReportSummary[];
  participantCount: number;
  activeParticipantCount: number;
  currentUserParticipant: MeetingParticipant | null;
};

export type LeaveMeetingPayload = {
  participant: MeetingParticipant;
  meetingEnded: boolean;
  meeting: Meeting;
  currentRecording: MeetingRecording | null;
};

export type StartRecordingPayload = {
  meeting: Meeting;
  recording: MeetingRecording;
};

export type EndRecordingPayload = {
  meeting: Meeting;
  recording: MeetingRecording;
  report: MeetingReportSummary | null;
};

export type RecordingListPayload = {
  recordings: MeetingRecording[];
};

export type CurrentRecordingPayload = {
  recording: MeetingRecording | null;
};

export type ParticipantListPayload = {
  participants: MeetingParticipant[];
};

export type MeetingReportListQuery = {
  cursor?: string;
  from?: string;
  status?: MeetingReportStatus;
  q?: string;
  to?: string;
  limit?: number;
};

export type MeetingReportListPayload = {
  nextCursor: string | null;
  reports: MeetingReportSummary[];
};

export type MeetingReportDetailPayload = {
  report: MeetingReportDetail;
};

export type MeetingReportRegenerationPayload = {
  report: MeetingReportSummary;
};

export type MeetingReportActionItemMutationPayload = {
  actionItem: MeetingReportActionItem;
};
