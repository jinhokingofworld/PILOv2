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
  title: string | null;
  summary: string | null;
  discussionPoints: string | null;
  decisions: string | null;
  contentVersion: number;
  contentEditedByUserId: string | null;
  contentEditedAt: string | null;
  actionItemCandidates: unknown[];
  actionItemExtraction?: {
    status: "PENDING" | "PUBLISHING" | "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
    errorMessage: string | null;
  };
  retryCount: number;
  participantSummary?: {
    totalCount: number;
    participants: Array<{ userId: string; name: string | null; avatarUrl: string | null }>;
    hasMore: boolean;
  };
  canDelete?: boolean;
  canEdit?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MeetingReportActionItemExtractionRetryPayload = {
  actionItemExtraction: NonNullable<MeetingReportSummary["actionItemExtraction"]>;
};

export type MeetingReportDetail = MeetingReportSummary & {
  transcriptText: string | null;
  evidenceSegments?: Array<{ id: string; segmentIndex: number; startedAtMs: number; endedAtMs: number; text: string }>;
  evidence?: Array<{ sourceType: string; sourceIndex: number; transcriptSegmentId: string }>;
  activityEvidence?: Array<{
    id: string;
    sourceIndex: number;
    occurredAt: string;
    action: string;
    summary: string;
    references: Array<{ sourceType: string; sourceIndex: number }>;
  }>;
  actionItems?: MeetingReportActionItem[];
  actionItemAssignees?: MeetingReportActionItemAssignee[];
  decisionItems?: MeetingReportDecisionItem[];
};

export type MeetingReportDecisionItem = {
  id: string;
  sourceIndex: number;
  text: string;
  isUserEdited: boolean;
  editedByUserId: string | null;
  editedAt: string | null;
};

export type UpdateMeetingReportContentInput = {
  expectedVersion: number;
  title?: string;
  discussionPoints?: string;
  decisionItems?: Array<{ id: string; text: string }>;
};

export type MeetingReportActionItemStatus =
  | "PENDING"
  | "DELIVERING"
  | "DELIVERY_FAILED"
  | "APPROVED"
  | "DISMISSED";

export type MeetingReportActionItemDeliveryInput =
  | {
      deliveryType: "calendar_event";
      calendar: {
        title?: string;
        description?: string | null;
        color?: string;
        isAllDay?: boolean;
        startDate: string;
        endDate?: string;
        startTime?: string | null;
        endTime?: string | null;
      };
    }
  | {
      deliveryType: "pilo_issue";
      issue: {
        boardId: string;
        columnId: string;
        title?: string;
        body?: string;
      };
    };

export type MeetingReportActionItemDelivery = {
  deliveryType: "calendar_event" | "pilo_issue";
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  errorCode: string | null;
  draft: MeetingReportActionItemDeliveryInput | null;
  targetResourceId: string | null;
  calendarEvent: { id: string; title: string } | null;
  piloIssue: {
    id: string;
    title: string;
    boardId: string;
    columnId: string;
    columnName: string | null;
  } | null;
};

export type MeetingReportActionItemDeliveryOptions = {
  boards: Array<{
    id: string;
    name: string;
    columns: Array<{ id: string; name: string }>;
  }>;
};

export type MeetingReportActionItemDeliveryResult = {
  actionItemId: string;
  deliveryType: "calendar_event" | "pilo_issue";
  status: "COMPLETED" | "FAILED" | "LEGACY_APPROVED";
  calendarEventId?: number;
  piloIssueId?: string;
  errorCode?: string;
};

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
  deliverySuggestion: {
    deliveryType: "calendar_event" | "pilo_issue";
    calendar: {
      isAllDay: boolean;
      startDate: string;
      endDate: string;
      startTime: string | null;
      endTime: string | null;
    } | null;
  } | null;
  status: MeetingReportActionItemStatus;
  updatedByUserId: string | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
  dismissedByUserId: string | null;
  dismissedAt: string | null;
  delivery: MeetingReportActionItemDelivery | null;
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

export type MeetingRoomNameInput = {
  name: string;
};

export type MeetingRoomMutationPayload = {
  room: MeetingRoom;
};

export type DeleteMeetingRoomPayload = {
  deleted: true;
};

export type CurrentUserActiveMeetingPayload = {
  meeting: Meeting | null;
  meetingRoom: MeetingRoom | null;
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

export type MeetingReportContentMutationPayload = {
  report: MeetingReportDetail;
};

export type MeetingReportRegenerationPayload = {
  report: MeetingReportSummary;
};

export type MeetingReportDeletionPayload = {
  deletedReportId: string;
};

export type MeetingReportActionItemMutationPayload = {
  actionItem: MeetingReportActionItem;
};
