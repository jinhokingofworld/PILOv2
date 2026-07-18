import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { QueryResultRow } from "pg";
import {
  ApiError,
  badRequest,
  conflict,
  forbidden,
  notFound,
  workspaceRecordingConsentRequired
} from "../../common/api-error";
import {
  DatabaseService,
  DatabaseTransaction
} from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import {
  LiveKitEgressService,
  StopLiveKitEgressResult
} from "./livekit-egress.service";
import {
  LiveKitJoinPayload,
  LiveKitTokenService
} from "./livekit-token.service";
import {
  MeetingReportJobPayload,
  MeetingReportJobService
} from "./meeting-report-job.service";
import { MeetingReportRealtimePublisherService } from "./meeting-report-realtime-publisher.service";
import {
  MeetingStateRealtimePublisherService,
  type MeetingStateChange,
  type MeetingStateRealtimeEventInput
} from "./meeting-state-realtime-publisher.service";
import { MeetingNotificationService } from "./meeting-notification.service";
import type { MeetingActionItemDeliveryInput } from "./meeting-action-item-delivery.service";

type RecordingStatus = "RUNNING" | "COMPLETED" | "FAILED";
type MeetingReportStatus =
  | "PROCESSING"
  | "QUEUED"
  | "TRANSCRIBING"
  | "SUMMARIZING"
  | "COMPLETED"
  | "FAILED";
type MeetingReportFailedStep = "RECORDING" | "STT" | "LLM";
type MeetingReportActionItemExtractionStatus =
  | "PENDING"
  | "PUBLISHING"
  | "QUEUED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED";
type MeetingReportActionItemStatus =
  | "PENDING"
  | "DELIVERING"
  | "DELIVERY_FAILED"
  | "APPROVED"
  | "DISMISSED";

interface MeetingRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  room_key: string;
  livekit_room_name: string;
  created_by_id: string;
  ended_by_id: string | null;
  started_at: Date | string;
  ended_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface MeetingRoomRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  room_key: string;
  name: string;
  created_by_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface CurrentMeetingRow extends MeetingRow {
  recording_id: string | null;
  recording_meeting_id: string | null;
  recording_livekit_egress_id: string | null;
  recording_status: RecordingStatus | null;
  recording_audio_file_url: string | null;
  recording_audio_file_key: string | null;
  recording_duration_sec: number | null;
  recording_file_size_bytes: number | string | null;
  recording_started_at: Date | string | null;
  recording_ended_at: Date | string | null;
  recording_error_message: string | null;
  active_participant_count: number | string;
}

interface StartMeetingRow extends QueryResultRow {
  meeting_id: string;
  meeting_workspace_id: string;
  meeting_room_key: string;
  meeting_livekit_room_name: string;
  meeting_created_by_id: string;
  meeting_ended_by_id: string | null;
  meeting_started_at: Date | string;
  meeting_ended_at: Date | string | null;
  meeting_created_at: Date | string;
  meeting_updated_at: Date | string;
  participant_id: string;
  participant_meeting_id: string;
  participant_user_id: string;
  participant_livekit_identity: string;
  participant_joined_at: Date | string;
  participant_left_at: Date | string | null;
  participant_user_name: string | null;
  participant_user_avatar_url: string | null;
}

interface ParticipantRow extends QueryResultRow {
  id: string;
  meeting_id: string;
  user_id: string;
  livekit_identity: string;
  joined_at: Date | string;
  left_at: Date | string | null;
  user_name: string | null;
  user_avatar_url: string | null;
}

interface RecordingRow extends QueryResultRow {
  id: string;
  meeting_id: string;
  livekit_egress_id: string | null;
  status: RecordingStatus;
  audio_file_url: string | null;
  audio_file_key: string | null;
  duration_sec: number | null;
  file_size_bytes: number | string | null;
  started_at: Date | string;
  ended_at: Date | string | null;
  error_message: string | null;
}

interface MeetingReportRow extends QueryResultRow {
  id: string;
  meeting_id: string;
  recording_id: string;
  status: MeetingReportStatus;
  failed_step: MeetingReportFailedStep | null;
  error_message: string | null;
  failure_code?: string | null;
  failure_detail?: unknown;
  title: string | null;
  ai_title?: string | null;
  user_title: string | null;
  summary: string | null;
  discussion_points: string | null;
  ai_discussion_points?: string | null;
  user_discussion_points: string | null;
  decisions: string | null;
  ai_decisions?: string | null;
  content_version: number | string;
  content_edited_by_user_id: string | null;
  content_edited_at: Date | string | null;
  action_item_candidates: unknown;
  retry_count: number | string;
  created_at: Date | string;
  updated_at: Date | string;
  participant_count?: number | string;
  participant_preview?: unknown;
  can_delete?: boolean;
  can_edit?: boolean;
  action_item_extraction_status?: string | null;
  action_item_extraction_failure_code?: string | null;
}

interface MeetingReportDetailRow extends MeetingReportRow {
  transcript_text: string | null;
}

interface MeetingReportDecisionItemRow extends QueryResultRow {
  id: string;
  source_index: number | string;
  text: string;
  user_text: string | null;
  edited_by_user_id: string | null;
  edited_at: Date | string | null;
}

interface MeetingReportActionItemRow extends QueryResultRow {
  id: string;
  meeting_report_id: string;
  source_index: number | string;
  title: string;
  description: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  assignee_user_id: string | null;
  assignee_name: string | null;
  assignee_avatar_url: string | null;
  action_item_candidates?: unknown;
  status: MeetingReportActionItemStatus;
  updated_by_user_id: string | null;
  approved_by_user_id: string | null;
  approved_at: Date | string | null;
  dismissed_by_user_id: string | null;
  dismissed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  delivery_id?: string | null;
  delivery_type?: "calendar_event" | "pilo_issue" | null;
  delivery_status?: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | null;
  delivery_error_code?: string | null;
  delivery_draft_json?: unknown;
  delivery_target_resource_id?: string | null;
  calendar_event_id?: number | string | null;
  calendar_event_title?: string | null;
  pilo_issue_id?: number | string | null;
  pilo_issue_title?: string | null;
  pilo_issue_board_id?: number | string | null;
  pilo_issue_column_id?: number | string | null;
  pilo_issue_column_name?: string | null;
}

interface MeetingReportActionItemAssigneeRow extends QueryResultRow {
  user_id: string;
  name: string | null;
  avatar_url: string | null;
}

interface MeetingReportRegenerationRow extends MeetingReportDetailRow {
  recording_status: RecordingStatus;
  recording_audio_file_key: string | null;
}

interface ActiveParticipantCountRow extends QueryResultRow {
  active_participant_count: number | string;
}

interface GeneratedIdRow extends QueryResultRow {
  id: string;
}

interface ParticipantCountRow extends QueryResultRow {
  participant_count: number | string;
  active_participant_count: number | string;
}

interface WorkspaceRecordingConsentRow extends QueryResultRow {
  workspace_id: string;
  user_id: string;
  policy_version: string;
  accepted_at: Date | string;
}

interface MissingWorkspaceRecordingConsentRow extends QueryResultRow {
  user_id: string;
}

interface QueryOneExecutor {
  queryOne<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<T | null>;
}

interface MeetingReportListQuery {
  cursor?: unknown;
  from?: unknown;
  status?: unknown;
  q?: unknown;
  to?: unknown;
  limit?: unknown;
}

/** Internal Agent query. Keep roomName out of the public Meeting REST contract. */
interface MeetingAgentReportListQuery extends MeetingReportListQuery {
  roomName?: unknown;
}

interface MeetingReportCursor {
  createdAt: string;
  id: string;
}

interface MeetingReportInsertResult {
  report: MeetingReportRow;
  inserted: boolean;
}

interface MeetingReportPreparation {
  report: MeetingReportRow | null;
  job: MeetingReportJobPayload | null;
}

interface EndRecordingTransactionResult {
  payload: EndRecordingPayload;
  job: MeetingReportJobPayload | null;
  stateChange: MeetingStateChange | null;
}

interface LeaveMeetingTransactionResult {
  payload: LeaveMeetingPayload;
  job: MeetingReportJobPayload | null;
  stateEvents: MeetingStateRealtimeEventInput[];
}

interface MeetingReportRegenerationTransactionResult {
  payload: MeetingReportRegenerationPayload;
  job: MeetingReportJobPayload;
  previousReport: MeetingReportRegenerationRow;
}

interface StartMeetingDraft {
  roomKey?: unknown;
  recordingConsent?: unknown;
}

interface RecordingConsentDraft {
  accepted: true;
  policyVersion: string;
}

interface MeetingRoomNameDraft {
  name?: unknown;
}

export interface MeetingPayload {
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
}

export interface MeetingRoomPayload {
  id: string;
  workspaceId: string;
  roomKey: string;
  name: string;
  isDefault: boolean;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingRoomListPayload {
  rooms: MeetingRoomPayload[];
}

export interface MeetingRoomMutationPayload {
  room: MeetingRoomPayload;
}

export interface DeleteMeetingRoomPayload {
  deleted: true;
}

export interface CurrentUserActiveMeetingPayload {
  meeting: MeetingPayload | null;
  meetingRoom: MeetingRoomPayload | null;
}

export interface ParticipantPayload {
  id: string;
  meetingId: string;
  userId: string;
  livekitIdentity: string;
  joinedAt: string;
  leftAt: string | null;
  isActive: boolean;
  user: {
    id: string;
    name: string | null;
    avatarUrl: string | null;
  };
}

export interface RecordingPayload {
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
}

export interface MeetingReportSummaryPayload {
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
  actionItemExtraction?: MeetingReportActionItemExtractionPayload;
  retryCount: number;
  participantSummary: MeetingReportParticipantSummaryPayload;
  canDelete?: boolean;
  canEdit?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingReportActionItemExtractionPayload {
  status: MeetingReportActionItemExtractionStatus;
  errorMessage: string | null;
}

export interface MeetingReportActionItemExtractionRetryPayload {
  actionItemExtraction: MeetingReportActionItemExtractionPayload;
}

export interface MeetingReportParticipantSummaryPayload {
  totalCount: number;
  participants: Array<{
    userId: string;
    name: string | null;
    avatarUrl: string | null;
  }>;
  hasMore: boolean;
}

export interface MeetingReportDetailPayload extends MeetingReportSummaryPayload {
  transcriptText: string | null;
  evidenceSegments: Array<{ id: string; segmentIndex: number; startedAtMs: number; endedAtMs: number; text: string }>;
  evidence: Array<{ sourceType: string; sourceIndex: number; transcriptSegmentId: string }>;
  activityEvidence: Array<{
    id: string;
    sourceIndex: number;
    occurredAt: string;
    action: string;
    summary: string;
    references: Array<{ sourceType: string; sourceIndex: number }>;
  }>;
  actionItems: MeetingReportActionItemPayload[];
  actionItemAssignees: MeetingReportActionItemAssigneePayload[];
  decisionItems: MeetingReportDecisionItemPayload[];
}

export interface MeetingReportDecisionItemPayload {
  id: string;
  sourceIndex: number;
  text: string;
  isUserEdited: boolean;
  editedByUserId: string | null;
  editedAt: string | null;
}

export interface MeetingReportContentMutationPayload {
  report: MeetingReportDetailPayload;
}

export interface MeetingReportActionItemPayload {
  id: string;
  sourceIndex: number;
  title: string;
  description: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  assignee: MeetingReportActionItemAssigneePayload | null;
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
  delivery: {
    deliveryType: "calendar_event" | "pilo_issue";
    status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
    errorCode: string | null;
    draft: MeetingActionItemDeliveryInput | null;
    targetResourceId: string | null;
    calendarEvent: { id: string; title: string } | null;
    piloIssue: {
      id: string;
      title: string;
      boardId: string;
      columnId: string;
      columnName: string | null;
    } | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingAgentMeetingSearchQuery {
  roomName?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface MeetingAgentMeetingSearchPayload {
  meeting: MeetingPayload;
  roomName: string;
}

export interface MeetingAgentActionItemSearchQuery {
  reportId?: string;
  assigneeUserId?: string;
  status?: "PENDING" | "DELIVERING" | "DELIVERY_FAILED" | "APPROVED" | "DISMISSED";
  title?: string;
  limit?: number;
}

export interface MeetingAgentActionItemSearchPayload {
  id: string;
  reportId: string;
  sourceIndex: number;
  title: string;
  status: "PENDING" | "DELIVERING" | "DELIVERY_FAILED" | "APPROVED" | "DISMISSED";
  assignee: MeetingReportActionItemAssigneePayload | null;
  reportCreatedAt: string;
}

export interface MeetingReportActionItemAssigneePayload {
  userId: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface MeetingReportActionItemMutationPayload {
  actionItem: MeetingReportActionItemPayload;
}

export interface CurrentMeetingPayload {
  meeting: MeetingPayload | null;
  currentRecording: RecordingPayload | null;
  activeParticipantCount: number;
}

export interface StartMeetingPayload {
  meeting: MeetingPayload;
  participant: ParticipantPayload;
  livekit: LiveKitJoinPayload;
  currentRecording: null;
}

export interface RecordingConsentInput {
  accepted: true;
  policyVersion: string;
}

export interface RecordingConsentStatusPayload {
  accepted: boolean;
  policyVersion: string;
}

export interface JoinMeetingPayload {
  meeting: MeetingPayload;
  participant: ParticipantPayload;
  livekit: LiveKitJoinPayload;
  currentRecording: RecordingPayload | null;
}

export interface StartRecordingPayload {
  meeting: MeetingPayload;
  recording: RecordingPayload;
}

export interface EndRecordingPayload {
  meeting: MeetingPayload;
  recording: RecordingPayload;
  report: MeetingReportSummaryPayload | null;
}

export interface LeaveMeetingPayload {
  participant: ParticipantPayload;
  meetingEnded: boolean;
  meeting: MeetingPayload;
  currentRecording: RecordingPayload | null;
}

export interface LiveKitParticipantDepartureInput {
  roomName: string | null;
  participantIdentity: string | null;
  eventCreatedAt: Date | null;
}

export interface LiveKitParticipantDepartureResult {
  job: MeetingReportJobPayload | null;
  stateEvents: MeetingStateRealtimeEventInput[];
}

export interface MeetingDetailPayload {
  meeting: MeetingPayload;
  currentRecording: RecordingPayload | null;
  recordings: RecordingPayload[];
  reports: MeetingReportSummaryPayload[];
  participantCount: number;
  activeParticipantCount: number;
  currentUserParticipant: ParticipantPayload | null;
}

export interface RecordingListPayload {
  recordings: RecordingPayload[];
}

export interface CurrentRecordingPayload {
  recording: RecordingPayload | null;
}

export interface ParticipantListPayload {
  participants: ParticipantPayload[];
}

export interface MeetingReportListPayload {
  nextCursor: string | null;
  reports: MeetingReportSummaryPayload[];
}

export interface MeetingReportDetailResponsePayload {
  report: MeetingReportDetailPayload;
}

export interface MeetingReportRegenerationPayload {
  report: MeetingReportSummaryPayload;
}

export interface MeetingReportDeletionPayload {
  deletedReportId: string;
}

const MAIN_MEETING_ROOM = "MAIN_MEETING_ROOM";
const WORKSPACE_RECORDING_CONSENT_POLICY_VERSION = "v1";
const UNIQUE_VIOLATION_CODE = "23505";
const ACTIVE_MEETING_UNIQUE_INDEX = "unique_active_meeting_per_room";
const MEETING_ALREADY_IN_PROGRESS_ERROR_CODE =
  "MEETING_ALREADY_IN_PROGRESS";
const MEETING_ALREADY_IN_PROGRESS_MESSAGE = "A meeting is already in progress";
const ACTIVE_MEETING_PARTICIPATION_EXISTS_MESSAGE =
  "Current user is already participating in another active meeting";
const DEFAULT_MEETING_ROOM_NAME = "기본 회의실";
const MEETING_ROOM_NAME_MAX_LENGTH = 100;
const ACTIVE_MEETING_ROOM_NAME_UNIQUE_INDEX =
  "unique_active_meeting_room_name";
const SAFE_EGRESS_START_ERROR = "LiveKit Egress start failed";
const SAFE_EGRESS_STOP_ERROR = "LiveKit Egress stop failed";
const DEFAULT_MEETING_REPORT_LIMIT = 20;
const MAX_MEETING_REPORT_LIMIT = 100;
const MEETING_REPORT_STATUSES: readonly MeetingReportStatus[] = [
  "PROCESSING",
  "QUEUED",
  "TRANSCRIBING",
  "SUMMARIZING",
  "COMPLETED",
  "FAILED"
];
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class MeetingService {
  private readonly logger = new Logger(MeetingService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly workspaceService: WorkspaceService,
    private readonly liveKitTokenService: LiveKitTokenService,
    private readonly liveKitEgressService: LiveKitEgressService,
    private readonly meetingReportJobService: MeetingReportJobService,
    private readonly meetingNotificationService: MeetingNotificationService,
    private readonly meetingReportRealtimePublisher?: MeetingReportRealtimePublisherService,
    private readonly meetingStateRealtimePublisher?: MeetingStateRealtimePublisherService
  ) {}

  getModuleInfo() {
    return {
      domain: "meeting",
      apiContract: "docs/api/meeting-api.md"
    };
  }

  async getCurrentMeeting(
    currentUserId: string,
    workspaceId: string
  ): Promise<CurrentMeetingPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    const currentMeeting = await this.findCurrentMeeting(
      workspaceId,
      MAIN_MEETING_ROOM
    );

    if (!currentMeeting) {
      return {
        meeting: null,
        currentRecording: null,
        activeParticipantCount: 0
      };
    }

    return {
      meeting: this.mapMeeting(currentMeeting),
      currentRecording: this.mapNullableCurrentRecording(currentMeeting),
      activeParticipantCount: Number(currentMeeting.active_participant_count)
    };
  }

  async getCurrentUserActiveMeeting(
    currentUserId: string
  ): Promise<CurrentUserActiveMeetingPayload> {
    const activeMeeting = await this.database.queryOne<
      CurrentMeetingRow & { meeting_room_id: string; meeting_room_name: string; meeting_room_created_by_id: string | null; meeting_room_created_at: Date | string; meeting_room_updated_at: Date | string }
    >(
      `
        SELECT
          meetings.id,
          meetings.workspace_id,
          meetings.room_key,
          meetings.livekit_room_name,
          meetings.created_by_id,
          meetings.ended_by_id,
          meetings.started_at,
          meetings.ended_at,
          meetings.created_at,
          meetings.updated_at,
          meeting_rooms.id AS meeting_room_id,
          meeting_rooms.name AS meeting_room_name,
          meeting_rooms.created_by_id AS meeting_room_created_by_id,
          meeting_rooms.created_at AS meeting_room_created_at,
          meeting_rooms.updated_at AS meeting_room_updated_at,
          NULL::uuid AS recording_id,
          NULL::uuid AS recording_meeting_id,
          NULL::text AS recording_livekit_egress_id,
          NULL::text AS recording_status,
          NULL::text AS recording_audio_file_url,
          NULL::text AS recording_audio_file_key,
          NULL::int AS recording_duration_sec,
          NULL::bigint AS recording_file_size_bytes,
          NULL::timestamptz AS recording_started_at,
          NULL::timestamptz AS recording_ended_at,
          NULL::text AS recording_error_message,
          0::int AS active_participant_count
        FROM meeting_participants
        JOIN meetings
          ON meetings.id = meeting_participants.meeting_id
        JOIN meeting_rooms
          ON meeting_rooms.workspace_id = meetings.workspace_id
          AND meeting_rooms.room_key = meetings.room_key
          AND meeting_rooms.archived_at IS NULL
        JOIN workspace_members
          ON workspace_members.workspace_id = meetings.workspace_id
          AND workspace_members.user_id = meeting_participants.user_id
        WHERE meeting_participants.user_id = $1::uuid
          AND meeting_participants.left_at IS NULL
          AND meetings.ended_at IS NULL
        ORDER BY meeting_participants.joined_at DESC, meetings.id ASC
        LIMIT 1
      `,
      [currentUserId]
    );

    if (!activeMeeting) {
      return { meeting: null, meetingRoom: null };
    }

    const isDefault = await this.isDefaultMeetingRoom(
      this.database,
      activeMeeting.workspace_id,
      activeMeeting.meeting_room_id
    );

    return {
      meeting: this.mapMeeting(activeMeeting),
      meetingRoom: this.mapMeetingRoom(
        {
          id: activeMeeting.meeting_room_id,
          workspace_id: activeMeeting.workspace_id,
          room_key: activeMeeting.room_key,
          name: activeMeeting.meeting_room_name,
          created_by_id: activeMeeting.meeting_room_created_by_id,
          created_at: activeMeeting.meeting_room_created_at,
          updated_at: activeMeeting.meeting_room_updated_at
        },
        isDefault
      )
    };
  }

  async getRecordingConsentStatus(
    currentUserId: string,
    workspaceId: string
  ): Promise<RecordingConsentStatusPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    const consent = await this.database.queryOne<{ accepted: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM workspace_recording_consents
          WHERE workspace_id = $1::uuid
            AND user_id = $2::uuid
            AND policy_version = $3
        ) AS accepted
      `,
      [workspaceId, currentUserId, WORKSPACE_RECORDING_CONSENT_POLICY_VERSION]
    );
    return {
      accepted: consent?.accepted === true,
      policyVersion: WORKSPACE_RECORDING_CONSENT_POLICY_VERSION
    };
  }

  async startMeeting(
    currentUserId: string,
    workspaceId: string,
    body: unknown
  ): Promise<StartMeetingPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    const { roomKey, recordingConsent } = this.normalizeStartMeetingBody(body);

    try {
      const result = await this.database.transaction(async (transaction) => {
        await this.assertNoOtherActiveMeetingParticipant(
          transaction,
          currentUserId
        );
        const existingMeeting = await this.findCurrentMeeting(
          workspaceId,
          roomKey,
          transaction
        );
        if (existingMeeting) {
          throw this.meetingAlreadyInProgress();
        }

        return this.createStartedMeeting(
          transaction,
          workspaceId,
          roomKey,
          currentUserId,
          recordingConsent
        );
      });
      await this.publishMeetingStarted(workspaceId, result.meeting.id);
      return result;
    } catch (error) {
      if (this.isConstraintError(error, ACTIVE_MEETING_UNIQUE_INDEX)) {
        throw this.meetingAlreadyInProgress();
      }

      throw error;
    }
  }

  async listMeetingRooms(
    currentUserId: string,
    workspaceId: string
  ): Promise<MeetingRoomListPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    const rooms = await this.database.query<MeetingRoomRow>(
      `
        SELECT id, workspace_id, room_key, name, created_by_id, created_at, updated_at
        FROM meeting_rooms
        WHERE workspace_id = $1
          AND archived_at IS NULL
        ORDER BY created_at ASC, id ASC
      `,
      [workspaceId]
    );

    return {
      rooms: rooms.map((room, index) => this.mapMeetingRoom(room, index === 0))
    };
  }

  async createMeetingRoom(
    currentUserId: string,
    workspaceId: string,
    body: unknown
  ): Promise<MeetingRoomMutationPayload> {
    await this.assertWorkspaceOwnerAccess(currentUserId, workspaceId);
    const name = this.normalizeMeetingRoomName(body);

    try {
      const room = await this.database.queryOne<MeetingRoomRow>(
        `
          WITH generated AS (
            SELECT gen_random_uuid() AS id
          )
          INSERT INTO meeting_rooms (
            id,
            workspace_id,
            room_key,
            name,
            created_by_id
          )
          SELECT
            generated.id,
            $1::uuid,
            'ROOM_' || generated.id::text,
            $2,
            $3::uuid
          FROM generated
          RETURNING id, workspace_id, room_key, name, created_by_id, created_at, updated_at
        `,
        [workspaceId, name, currentUserId]
      );

      if (!room) {
        throw badRequest("Meeting room could not be created");
      }

      return {
        room: this.mapMeetingRoom(
          room,
          await this.isDefaultMeetingRoom(this.database, workspaceId, room.id)
        )
      };
    } catch (error) {
      if (this.isConstraintError(error, ACTIVE_MEETING_ROOM_NAME_UNIQUE_INDEX)) {
        throw conflict("A meeting room with this name already exists");
      }

      throw error;
    }
  }

  async updateMeetingRoom(
    currentUserId: string,
    workspaceId: string,
    meetingRoomId: string,
    body: unknown
  ): Promise<MeetingRoomMutationPayload> {
    await this.assertWorkspaceOwnerAccess(currentUserId, workspaceId);
    const name = this.normalizeMeetingRoomName(body);

    try {
      const room = await this.database.transaction(async (transaction) => {
        const existing = await this.findActiveMeetingRoom(
          transaction,
          workspaceId,
          meetingRoomId,
          { lockRoom: true }
        );
        if (!existing) {
          throw notFound("Meeting room not found");
        }
        return transaction.queryOne<MeetingRoomRow>(
          `
            UPDATE meeting_rooms
            SET name = $3, updated_at = now()
            WHERE workspace_id = $1
              AND id = $2::uuid
              AND archived_at IS NULL
            RETURNING id, workspace_id, room_key, name, created_by_id, created_at, updated_at
          `,
          [workspaceId, meetingRoomId, name]
        );
      });

      if (!room) {
        throw notFound("Meeting room not found");
      }

      return {
        room: this.mapMeetingRoom(
          room,
          await this.isDefaultMeetingRoom(this.database, workspaceId, room.id)
        )
      };
    } catch (error) {
      if (this.isConstraintError(error, ACTIVE_MEETING_ROOM_NAME_UNIQUE_INDEX)) {
        throw conflict("A meeting room with this name already exists");
      }

      throw error;
    }
  }

  async deleteMeetingRoom(
    currentUserId: string,
    workspaceId: string,
    meetingRoomId: string
  ): Promise<DeleteMeetingRoomPayload> {
    await this.assertWorkspaceOwnerAccess(currentUserId, workspaceId);

    await this.database.transaction(async (transaction) => {
      const room = await this.findActiveMeetingRoom(
        transaction,
        workspaceId,
        meetingRoomId,
        { lockRoom: true }
      );
      if (!room) {
        throw notFound("Meeting room not found");
      }
      if (await this.isDefaultMeetingRoom(transaction, workspaceId, meetingRoomId)) {
        throw badRequest("Default meeting room cannot be deleted");
      }

      const activeMeeting = await this.findCurrentMeeting(
        workspaceId,
        room.room_key,
        transaction
      );
      if (activeMeeting) {
        throw conflict("Meeting room with an active meeting cannot be deleted");
      }

      await transaction.queryOne(
        `
          UPDATE meeting_rooms
          SET archived_at = now(), updated_at = now()
          WHERE workspace_id = $1
            AND id = $2::uuid
            AND archived_at IS NULL
          RETURNING id
        `,
        [workspaceId, meetingRoomId]
      );
    });

    return { deleted: true };
  }

  async getCurrentMeetingForRoom(
    currentUserId: string,
    workspaceId: string,
    meetingRoomId: string
  ): Promise<CurrentMeetingPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    const room = await this.requireActiveMeetingRoom(
      this.database,
      workspaceId,
      meetingRoomId
    );
    return this.currentMeetingPayload(workspaceId, room.room_key);
  }

  async startMeetingInRoom(
    currentUserId: string,
    workspaceId: string,
    meetingRoomId: string,
    body: unknown
  ): Promise<StartMeetingPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    const { recordingConsent } = this.normalizeStartMeetingBody(body);

    try {
      const result = await this.database.transaction(async (transaction) => {
        const room = await this.requireActiveMeetingRoom(
          transaction,
          workspaceId,
          meetingRoomId,
          { lockRoom: true }
        );
        const existingMeeting = await this.findCurrentMeeting(
          workspaceId,
          room.room_key,
          transaction
        );
        if (existingMeeting) {
          throw this.meetingAlreadyInProgress();
        }

        await this.assertNoOtherActiveMeetingParticipant(
          transaction,
          currentUserId
        );

        return this.createStartedMeeting(
          transaction,
          workspaceId,
          room.room_key,
          currentUserId,
          recordingConsent
        );
      });
      await this.publishMeetingStarted(workspaceId, result.meeting.id);
      return result;
    } catch (error) {
      if (this.isConstraintError(error, ACTIVE_MEETING_UNIQUE_INDEX)) {
        throw this.meetingAlreadyInProgress();
      }

      throw error;
    }
  }

  async joinMeeting(
    currentUserId: string,
    workspaceId: string,
    meetingId: string,
    body: unknown
  ): Promise<JoinMeetingPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    const { recordingConsent } = this.normalizeStartMeetingBody(body);
    const result = await this.database.transaction(async (transaction) => {
      const meeting = await this.findMeetingById(transaction, workspaceId, meetingId, {
        lockMeeting: true
      });

      if (!meeting) {
        throw notFound("Meeting not found");
      }

      if (meeting.ended_at !== null) {
        throw badRequest("Meeting has already ended");
      }

      await this.ensureWorkspaceRecordingConsent(
        transaction,
        workspaceId,
        currentUserId,
        recordingConsent
      );

      await this.assertNoOtherActiveMeetingParticipant(
        transaction,
        currentUserId,
        meetingId
      );

      const participant = await this.upsertParticipant(
        transaction,
        meetingId,
        currentUserId
      );
      const livekit = await this.liveKitTokenService.createJoinToken({
        livekitRoomName: meeting.livekit_room_name,
        livekitIdentity: participant.livekit_identity,
        participantName: participant.user_name
      });

      return {
        meeting: this.mapMeeting(meeting),
        participant: this.mapParticipant(participant),
        livekit,
        currentRecording: this.mapNullableCurrentRecording(meeting)
      };
    });
    await this.publishMeetingStateEvent({
      workspaceId,
      meetingId: result.meeting.id,
      change: "participant_joined"
    });
    return result;
  }

  async getMeeting(
    currentUserId: string,
    workspaceId: string,
    meetingId: string
  ): Promise<MeetingDetailPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    const meeting = await this.findMeetingById(this.database, workspaceId, meetingId);

    if (!meeting) {
      throw notFound("Meeting not found");
    }

    const recordings = await this.listRecordingRows(meetingId);
    const reports = await this.listMeetingReportRows(meetingId);
    const participantCounts = await this.countParticipants(meetingId);
    const currentUserParticipant = await this.findParticipantSummary(
      this.database,
      meetingId,
      currentUserId
    );

    return {
      meeting: this.mapMeeting(meeting),
      currentRecording: this.mapNullableCurrentRecording(meeting),
      recordings: recordings.map((recording) => this.mapRecording(recording)),
      reports: reports.map((report) => this.mapMeetingReportSummary(report)),
      participantCount: participantCounts.participantCount,
      activeParticipantCount: participantCounts.activeParticipantCount,
      currentUserParticipant:
        currentUserParticipant === null
          ? null
          : this.mapParticipant(currentUserParticipant)
    };
  }

  async leaveMeeting(
    currentUserId: string,
    workspaceId: string,
    meetingId: string
  ): Promise<LeaveMeetingPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    const result = await this.database.transaction<LeaveMeetingTransactionResult>(
      async (transaction) => {
        const meeting = await this.findMeetingById(
          transaction,
          workspaceId,
          meetingId,
          {
            lockMeeting: true
          }
        );

        if (!meeting) {
          throw notFound("Meeting not found");
        }

        const existingParticipant = await this.findActiveParticipant(
          transaction,
          meetingId,
          currentUserId
        );
        if (!existingParticipant) {
          throw notFound("Participant not found");
        }

        const activeParticipantCount = await this.countActiveParticipants(
          transaction,
          meetingId
        );
        const wasActive = existingParticipant.left_at === null;
        const shouldEndMeeting =
          wasActive && activeParticipantCount === 1 && meeting.ended_at === null;

        const runningRecording =
          shouldEndMeeting && meeting.recording_id !== null
            ? await this.findRunningRecording(transaction, meetingId, {
                lockRecording: true
              })
            : null;
        const stoppedRecording =
          runningRecording === null
            ? null
            : await this.stopRunningRecording(transaction, meeting, runningRecording);

        if (stoppedRecording !== null && stoppedRecording.status !== "COMPLETED") {
          throw badRequest("Running recording could not be completed before leaving");
        }

        const reportPreparation =
          stoppedRecording === null
            ? { report: null, job: null }
            : await this.prepareReportForStoppedRecording(transaction, stoppedRecording);
        const participant = await this.markParticipantLeft(
          transaction,
          existingParticipant.id
        );
        const endedMeeting = shouldEndMeeting
          ? await this.endMeetingIfStillActive(transaction, workspaceId, meetingId)
          : null;

        return {
          payload: {
            participant: this.mapParticipant(participant),
            meetingEnded: endedMeeting !== null,
            meeting: this.mapMeeting(endedMeeting ?? meeting),
            currentRecording:
              stoppedRecording === null
                ? this.mapNullableCurrentRecording(meeting)
                : null
          },
          job: reportPreparation.job,
          stateEvents: wasActive
            ? [
                {
                  workspaceId,
                  meetingId,
                  change: "participant_left"
                },
                ...(endedMeeting === null
                  ? []
                  : [{ workspaceId, meetingId, change: "ended" as const }]),
                ...(stoppedRecording === null
                  ? []
                  : [
                      {
                        workspaceId,
                        meetingId,
                        change:
                          stoppedRecording.status === "FAILED"
                            ? "recording_failed" as const
                            : "recording_ended" as const
                      }
                    ])
              ]
            : []
        };
      }
    );

    await this.publishMeetingReportOutbox(result.job);
    await this.publishMeetingReportEvent(result.job?.reportId);
    await this.publishMeetingStateEvents(result.stateEvents);

    return result.payload;
  }

  async reconcileLiveKitParticipantDeparture(
    transaction: DatabaseTransaction,
    input: LiveKitParticipantDepartureInput
  ): Promise<LiveKitParticipantDepartureResult> {
    if (
      input.roomName === null ||
      input.participantIdentity === null ||
      input.eventCreatedAt === null
    ) {
      return { job: null, stateEvents: [] };
    }

    const meeting = await this.findActiveMeetingByLiveKitRoomName(
      transaction,
      input.roomName
    );
    if (meeting === null) {
      return { job: null, stateEvents: [] };
    }

    const participant = await this.findParticipantByLiveKitIdentity(
      transaction,
      meeting.id,
      input.participantIdentity,
      { lockParticipant: true }
    );
    if (
      participant === null ||
      participant.left_at !== null ||
      input.eventCreatedAt.getTime() <= this.toDate(participant.joined_at).getTime()
    ) {
      return { job: null, stateEvents: [] };
    }

    const activeParticipantCount = await this.countActiveParticipants(
      transaction,
      meeting.id
    );
    const shouldEndMeeting = activeParticipantCount === 1;
    const runningRecording =
      shouldEndMeeting && meeting.recording_id !== null
        ? await this.findRunningRecording(transaction, meeting.id, {
            lockRecording: true
          })
        : null;
    const stoppedRecording =
      runningRecording === null
        ? null
        : await this.stopRunningRecording(transaction, meeting, runningRecording);
    const reportPreparation =
      stoppedRecording === null
        ? { report: null, job: null }
        : await this.prepareReportForStoppedRecording(transaction, stoppedRecording);

    await this.markParticipantLeft(transaction, participant.id);

    if (shouldEndMeeting) {
      await this.endMeetingIfStillActive(
        transaction,
        meeting.workspace_id,
        meeting.id
      );
    }

    return {
      job: reportPreparation.job,
      stateEvents: [
        {
          workspaceId: meeting.workspace_id,
          meetingId: meeting.id,
          change: "participant_left"
        },
        ...(shouldEndMeeting
          ? [{ workspaceId: meeting.workspace_id, meetingId: meeting.id, change: "ended" as const }]
          : []),
        ...(stoppedRecording === null
          ? []
          : [
              {
                workspaceId: meeting.workspace_id,
                meetingId: meeting.id,
                change:
                  stoppedRecording.status === "FAILED"
                    ? "recording_failed" as const
                    : "recording_ended" as const
              }
            ])
      ]
    };
  }

  async enqueueReconciledMeetingReportJob(
    job: MeetingReportJobPayload | null
  ): Promise<void> {
    await this.publishMeetingReportOutbox(job);
  }

  async publishReconciledMeetingStateEvents(
    stateEvents: MeetingStateRealtimeEventInput[]
  ): Promise<void> {
    await this.publishMeetingStateEvents(stateEvents);
  }

  async startRecording(
    currentUserId: string,
    workspaceId: string,
    meetingId: string
  ): Promise<StartRecordingPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);

    const prepared = await this.database.transaction(async (transaction) => {
      const meeting = await this.findMeetingById(transaction, workspaceId, meetingId, {
        lockMeeting: true
      });

      if (!meeting) {
        throw notFound("Meeting not found");
      }

      if (meeting.ended_at !== null) {
        throw badRequest("Meeting has already ended");
      }

      await this.assertActiveParticipant(transaction, meetingId, currentUserId);
      await this.assertAllActiveParticipantsHaveRecordingConsent(
        transaction,
        workspaceId,
        meetingId
      );

      const runningRecording = await this.findRunningRecording(
        transaction,
        meetingId,
        {
          lockRecording: true
        }
      );
      if (runningRecording) {
        return {
          shouldStartEgress: false as const,
          meeting: this.mapMeeting(meeting),
          recording: this.mapRecording(runningRecording)
        };
      }

      const recordingId = await this.generateId(transaction);
      const audioFileKey = this.buildAudioFileKey(
        workspaceId,
        meetingId,
        recordingId
      );

      const recording = await this.insertRunningRecording(transaction, {
        recordingId,
        meetingId,
        livekitEgressId: null,
        audioFileKey
      });

      return {
        shouldStartEgress: true as const,
        meeting,
        recording,
        audioFileKey,
        livekitRoomName: meeting.livekit_room_name
      };
    });

    if (!prepared.shouldStartEgress) {
      return {
        meeting: prepared.meeting,
        recording: prepared.recording
      };
    }

    let livekitEgressId: string;
    try {
      const egress = await this.liveKitEgressService.startRoomAudioOnlyEgress({
        livekitRoomName: prepared.livekitRoomName,
        audioFileKey: prepared.audioFileKey
      });
      livekitEgressId = egress.livekitEgressId;
    } catch {
      const recording = await this.database.transaction((transaction) =>
        this.updateRecordingFailed(
          transaction,
          prepared.recording,
          SAFE_EGRESS_START_ERROR
        )
      );
      await this.publishMeetingStateEvent({
        workspaceId,
        meetingId,
        change: "recording_failed"
      });

      return {
        meeting: this.mapMeeting(prepared.meeting),
        recording: this.mapRecording(recording)
      };
    }

    try {
      const recording = await this.database.transaction((transaction) =>
        this.updateRecordingLiveKitEgressId(
          transaction,
          prepared.recording,
          livekitEgressId
        )
      );
      await this.publishMeetingStateEvent({
        workspaceId,
        meetingId,
        change: "recording_started"
      });

      return {
        meeting: this.mapMeeting(prepared.meeting),
        recording: this.mapRecording(recording)
      };
    } catch (error) {
      await this.stopStartedEgressAfterPersistenceFailure(livekitEgressId);
      const failedRecording = await this.markRecordingFailedAfterPersistenceFailure(
        prepared.recording
      );
      if (failedRecording !== null) {
        await this.publishMeetingStateEvent({
          workspaceId,
          meetingId,
          change: "recording_failed"
        });
      }
      throw error;
    }
  }

  async endRecordingAndCreateReport(
    currentUserId: string,
    workspaceId: string,
    meetingId: string,
    recordingId: string
  ): Promise<EndRecordingPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    const result = await this.database.transaction<EndRecordingTransactionResult>(
      async (transaction) => {
        const meeting = await this.findMeetingById(
          transaction,
          workspaceId,
          meetingId,
          {
            lockMeeting: true
          }
        );

        if (!meeting) {
          throw notFound("Meeting not found");
        }

        await this.assertActiveParticipant(transaction, meetingId, currentUserId);

        const recording = await this.findRecordingById(
          transaction,
          meetingId,
          recordingId,
          {
            lockRecording: true
          }
        );

        if (!recording) {
          throw notFound("Recording not found");
        }

        const stoppedRecording =
          recording.status === "RUNNING"
            ? await this.stopRunningRecording(transaction, meeting, recording)
            : recording;
        const reportPreparation = await this.prepareReportForStoppedRecording(
          transaction,
          stoppedRecording
        );

        return {
          payload: {
            meeting: this.mapMeeting(meeting),
            recording: this.mapRecording(stoppedRecording),
            report:
              reportPreparation.report === null
                ? null
                : this.mapMeetingReportSummary(reportPreparation.report)
          },
          job: reportPreparation.job,
          stateChange:
            recording.status !== "RUNNING"
              ? null
              : stoppedRecording.status === "FAILED"
                ? "recording_failed"
                : "recording_ended"
        };
      }
    );

    await this.publishMeetingReportOutbox(result.job);
    await this.publishMeetingReportEvent(result.job?.reportId);
    await this.publishMeetingReportEvent(result.payload.report?.id);
    if (result.stateChange !== null) {
      await this.publishMeetingStateEvent({
        workspaceId,
        meetingId,
        change: result.stateChange
      });
    }
    return result.payload;
  }

  async listRecordings(
    currentUserId: string,
    workspaceId: string,
    meetingId: string
  ): Promise<RecordingListPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    await this.assertMeetingExists(workspaceId, meetingId);
    const recordings = await this.listRecordingRows(meetingId);

    return {
      recordings: recordings.map((recording) => this.mapRecording(recording))
    };
  }

  async getCurrentRecording(
    currentUserId: string,
    workspaceId: string,
    meetingId: string
  ): Promise<CurrentRecordingPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    const meeting = await this.findMeetingById(this.database, workspaceId, meetingId);

    if (!meeting) {
      throw notFound("Meeting not found");
    }

    return {
      recording: this.mapNullableCurrentRecording(meeting)
    };
  }

  async listParticipants(
    currentUserId: string,
    workspaceId: string,
    meetingId: string
  ): Promise<ParticipantListPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    await this.assertMeetingExists(workspaceId, meetingId);
    const participants = await this.listParticipantRows(meetingId);

    return {
      participants: participants.map((participant) =>
        this.mapParticipant(participant)
      )
    };
  }

  async listReports(
    currentUserId: string,
    workspaceId: string,
    query: MeetingReportListQuery
  ): Promise<MeetingReportListPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    const cursor = this.normalizeMeetingReportCursor(query.cursor);
    const from = this.normalizeMeetingReportDate(query.from, "from");
    const to = this.normalizeMeetingReportDate(query.to, "to");
    const searchQuery = this.normalizeMeetingReportSearchQuery(query.q);
    const status = this.normalizeMeetingReportStatus(query.status);
    const limit = this.normalizeMeetingReportLimit(query.limit);
    if (from !== null && to !== null && from >= to) {
      throw badRequest("from must be before to");
    }
    const page = await this.listWorkspaceMeetingReportRows(
      workspaceId,
      currentUserId,
      status,
      limit,
      { cursor, from, searchQuery, to }
    );

    return {
      nextCursor: page.nextCursor,
      reports: page.reports.map((report) => this.mapMeetingReportSummary(report))
    };
  }

  async listReportsForAgent(
    currentUserId: string,
    workspaceId: string,
    query: MeetingAgentReportListQuery
  ): Promise<MeetingReportListPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    const cursor = this.normalizeMeetingReportCursor(query.cursor);
    const from = this.normalizeMeetingReportDate(query.from, "from");
    const to = this.normalizeMeetingReportDate(query.to, "to");
    const status = this.normalizeMeetingReportStatus(query.status);
    const limit = this.normalizeMeetingReportLimit(query.limit);
    const roomName = query.roomName === undefined
      ? null
      : this.normalizeAgentResolutionText(String(query.roomName));
    if (from !== null && to !== null && from >= to) {
      throw badRequest("from must be before to");
    }
    const page = await this.listWorkspaceMeetingReportRows(
      workspaceId,
      currentUserId,
      status,
      limit,
      { cursor, from, searchQuery: null, to, roomName }
    );
    return {
      nextCursor: page.nextCursor,
      reports: page.reports.map((report) => this.mapMeetingReportSummary(report))
    };
  }

  async listMeetingsForAgent(
    currentUserId: string,
    workspaceId: string,
    query: MeetingAgentMeetingSearchQuery
  ): Promise<{ meetings: MeetingAgentMeetingSearchPayload[] }> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    const limit = this.agentResolutionLimit(query.limit);
    const normalizedRoomName = query.roomName
      ? this.normalizeAgentResolutionText(query.roomName)
      : null;
    const values: unknown[] = [workspaceId];
    const roomNameCondition =
      normalizedRoomName === null
        ? ""
        : `AND lower(regexp_replace(BTRIM(meeting_rooms.name), '\\s+', ' ', 'g')) = $${values.push(normalizedRoomName)}`;
    const fromCondition = query.from
      ? `AND meetings.started_at >= $${values.push(query.from)}::timestamptz`
      : "";
    const toCondition = query.to
      ? `AND meetings.started_at < $${values.push(query.to)}::timestamptz`
      : "";
    const rows = await this.database.query<
      MeetingRow & { meeting_room_name: string }
    >(
      `
        SELECT
          meetings.id,
          meetings.workspace_id,
          meetings.room_key,
          meetings.livekit_room_name,
          meetings.created_by_id,
          meetings.ended_by_id,
          meetings.started_at,
          meetings.ended_at,
          meetings.created_at,
          meetings.updated_at,
          meeting_rooms.name AS meeting_room_name
        FROM meetings
        JOIN meeting_rooms
          ON meeting_rooms.workspace_id = meetings.workspace_id
          AND meeting_rooms.room_key = meetings.room_key
        WHERE meetings.workspace_id = $1
          ${roomNameCondition}
          ${fromCondition}
          ${toCondition}
        ORDER BY meetings.started_at DESC, meetings.id ASC
        LIMIT $${values.push(limit)}
      `,
      values
    );
    return {
      meetings: rows.map((row) => ({
        meeting: this.mapMeeting(row),
        roomName: row.meeting_room_name
      }))
    };
  }

  async listActionItemsForAgent(
    currentUserId: string,
    workspaceId: string,
    query: MeetingAgentActionItemSearchQuery
  ): Promise<{ actionItems: MeetingAgentActionItemSearchPayload[] }> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    if (
      (query.reportId !== undefined && !UUID_PATTERN.test(query.reportId)) ||
      (query.assigneeUserId !== undefined && !UUID_PATTERN.test(query.assigneeUserId))
    ) {
      return { actionItems: [] };
    }

    const limit = this.agentResolutionLimit(query.limit);
    const values: unknown[] = [workspaceId];
    const reportCondition =
      query.reportId === undefined
        ? ""
        : `AND action_items.meeting_report_id = $${values.push(query.reportId)}::uuid`;
    const assigneeCondition =
      query.assigneeUserId === undefined
        ? ""
        : `AND action_items.assignee_user_id = $${values.push(query.assigneeUserId)}::uuid`;
    const statusCondition =
      query.status === undefined
        ? ""
        : `AND action_items.status = $${values.push(query.status)}`;
    const title = query.title
      ? this.normalizeAgentResolutionText(query.title)
      : null;
    const titleCondition =
      title === null
        ? ""
        : `AND lower(regexp_replace(BTRIM(action_items.title), '\\s+', ' ', 'g')) = $${values.push(title)}`;
    const rows = await this.database.query<
      QueryResultRow & {
        id: string;
        meeting_report_id: string;
        source_index: number | string;
        title: string;
        status: MeetingAgentActionItemSearchPayload["status"];
        assignee_user_id: string | null;
        assignee_name: string | null;
        assignee_avatar_url: string | null;
        report_created_at: Date | string;
      }
    >(
      `
        SELECT
          action_items.id,
          action_items.meeting_report_id,
          action_items.source_index,
          action_items.title,
          action_items.status,
          action_items.assignee_user_id,
          users.name AS assignee_name,
          users.avatar_url AS assignee_avatar_url,
          meeting_reports.created_at AS report_created_at
        FROM meeting_report_action_items AS action_items
        JOIN meeting_reports
          ON meeting_reports.id = action_items.meeting_report_id
        JOIN meetings
          ON meetings.id = meeting_reports.meeting_id
        LEFT JOIN users
          ON users.id = action_items.assignee_user_id
        WHERE meetings.workspace_id = $1
          ${reportCondition}
          ${assigneeCondition}
          ${statusCondition}
          ${titleCondition}
        ORDER BY meeting_reports.created_at DESC, action_items.source_index ASC, action_items.id ASC
        LIMIT $${values.push(limit)}
      `,
      values
    );
    return {
      actionItems: rows.map((row) => ({
        id: row.id,
        reportId: row.meeting_report_id,
        sourceIndex: Number(row.source_index),
        title: row.title,
        status: row.status,
        assignee:
          row.assignee_user_id === null
            ? null
            : {
                userId: row.assignee_user_id,
                name: row.assignee_name,
                avatarUrl: row.assignee_avatar_url
              },
        reportCreatedAt: this.toIsoString(row.report_created_at)
      }))
    };
  }

  async getReport(
    currentUserId: string,
    workspaceId: string,
    reportId: string
  ): Promise<MeetingReportDetailResponsePayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    const report = await this.findMeetingReportDetailById(
      workspaceId,
      currentUserId,
      reportId
    );

    if (report === null) {
      throw notFound("Meeting report not found");
    }
    const [
      evidence,
      activityEvidence,
      actionItems,
      actionItemAssignees,
      decisionItems
    ] = await Promise.all([
      this.listMeetingReportEvidence(report.id),
      this.listMeetingReportActivityEvidence(report.id),
      this.listMeetingReportActionItems(report.id),
      this.listMeetingReportActionItemAssignees(workspaceId),
      this.listMeetingReportDecisionItems(report.id)
    ]);

    return {
      report: this.mapMeetingReportDetail(report, {
        ...evidence,
        activityEvidence,
        actionItems,
        actionItemAssignees,
        decisionItems
      })
    };
  }

  async updateMeetingReportContent(
    currentUserId: string,
    workspaceId: string,
    reportId: string,
    body: unknown
  ): Promise<MeetingReportContentMutationPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    const patch = this.normalizeMeetingReportContentPatch(body);

    await this.database.transaction(async (transaction) => {
      const report = await transaction.queryOne<{
        id: string;
        status: MeetingReportStatus;
        content_version: number | string;
        can_edit: boolean;
      }>(
        `SELECT
           meeting_reports.id,
           meeting_reports.status,
           meeting_reports.content_version,
           (
             EXISTS (
               SELECT 1
               FROM workspace_members
               WHERE workspace_members.workspace_id = meetings.workspace_id
                 AND workspace_members.user_id = $2
                 AND workspace_members.role = 'owner'
             )
             OR EXISTS (
               SELECT 1
               FROM meeting_participants
               WHERE meeting_participants.meeting_id = meeting_reports.meeting_id
                 AND meeting_participants.user_id = $2
             )
           ) AS can_edit
         FROM meeting_reports
         JOIN meetings ON meetings.id = meeting_reports.meeting_id
         WHERE meetings.workspace_id = $1
           AND meeting_reports.id = $3
         FOR UPDATE OF meeting_reports`,
        [workspaceId, currentUserId, reportId]
      );

      if (report === null) {
        throw notFound("Meeting report not found");
      }
      if (!report.can_edit) {
        throw forbidden("Only the workspace owner or a meeting participant can edit this report");
      }
      if (report.status !== "COMPLETED") {
        throw badRequest("Only completed meeting reports can be edited");
      }
      if (Number(report.content_version) !== patch.expectedVersion) {
        throw conflict("Meeting report content was updated by another user");
      }

      if (patch.title !== undefined || patch.discussionPoints !== undefined) {
        const updated = await transaction.queryOne<{ id: string }>(
          `UPDATE meeting_reports
           SET
             user_title = COALESCE($2, user_title),
             user_discussion_points = COALESCE($3, user_discussion_points),
             updated_at = now()
           WHERE id = $1
           RETURNING id`,
          [
            report.id,
            patch.title ?? null,
            patch.discussionPoints ?? null
          ]
        );
        if (updated === null) throw notFound("Meeting report not found");
      }

      if (patch.decisionItems.length) {
        for (const item of patch.decisionItems) {
          const updated = await transaction.queryOne<{ id: string }>(
            `UPDATE meeting_report_decision_items
             SET
               user_text = $3,
               edited_by_user_id = $4,
               edited_at = now()
             WHERE id = $1
               AND meeting_report_id = $2
             RETURNING id`,
            [item.id, report.id, item.text, currentUserId]
          );
          if (updated === null) {
            throw badRequest("Invalid meeting report decision item");
          }
        }
      }

      const updated = await transaction.queryOne<{ id: string }>(
        `UPDATE meeting_reports
         SET
           content_version = content_version + 1,
           content_edited_by_user_id = $2,
           content_edited_at = now(),
           updated_at = now()
         WHERE id = $1
         RETURNING id`,
        [report.id, currentUserId]
      );
      if (updated === null) throw notFound("Meeting report not found");
    });

    const result = await this.getReport(currentUserId, workspaceId, reportId);
    await this.publishMeetingReportEvent(reportId);
    return result;
  }

  async retryMeetingReportActionItemExtraction(
    currentUserId: string,
    workspaceId: string,
    reportId: string
  ): Promise<MeetingReportActionItemExtractionRetryPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    if (!UUID_PATTERN.test(reportId)) {
      throw notFound("Meeting report not found");
    }
    const extraction = await this.database.queryOne<{
      status: string;
    }>(
      `UPDATE meeting_report_action_item_extractions AS extraction
       SET
         status = 'pending',
         attempt_count = 0,
         next_attempt_at = now(),
         claim_token = NULL,
         claimed_at = NULL,
         delivered_at = NULL,
         completed_at = NULL,
         failure_code = NULL,
         failure_detail = NULL,
         updated_at = now()
       FROM meeting_reports AS reports
       JOIN meetings ON meetings.id = reports.meeting_id
       WHERE extraction.meeting_report_id = reports.id
         AND reports.id = $2
         AND meetings.workspace_id = $1
         AND reports.status = 'COMPLETED'
         AND extraction.status = 'failed'
       RETURNING extraction.status`,
      [workspaceId, reportId]
    );
    if (!extraction) {
      throw badRequest("Meeting report follow-up tasks cannot be retried");
    }
    return {
      actionItemExtraction: {
        status: "PENDING",
        errorMessage: null
      }
    };
  }

  private agentResolutionLimit(value: number | undefined): number {
    if (!Number.isInteger(value) || value === undefined) {
      return 4;
    }
    return Math.min(Math.max(value, 1), 20);
  }

  private normalizeAgentResolutionText(value: string): string {
    return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
  }

  async getMeetingReportDecisionItem(
    currentUserId: string,
    workspaceId: string,
    reportId: string,
    sourceIndex: number
  ): Promise<{ sourceIndex: number; text: string } | null> {
    await this.getReport(currentUserId, workspaceId, reportId);
    return this.database.queryOne<{ source_index: number; text: string }>(
      `
        SELECT source_index, COALESCE(user_text, text) AS text
        FROM meeting_report_decision_items
        WHERE meeting_report_id = $1
          AND source_index = $2
        LIMIT 1
      `,
      [reportId, sourceIndex]
    ).then((row) =>
      row ? { sourceIndex: row.source_index, text: row.text } : null
    );
  }

  async deleteReport(
    currentUserId: string,
    workspaceId: string,
    reportId: string
  ): Promise<MeetingReportDeletionPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);

    return this.database.transaction(async (transaction) => {
      if (!UUID_PATTERN.test(reportId)) {
        throw notFound("Meeting report not found");
      }
      const report = await transaction.queryOne<{
        id: string;
        status: MeetingReportStatus;
        can_delete: boolean;
      }>(
        `SELECT
           meeting_reports.id,
           meeting_reports.status,
           (
             EXISTS (
               SELECT 1
               FROM workspace_members
               WHERE workspace_members.workspace_id = meetings.workspace_id
                 AND workspace_members.user_id = $2
                 AND workspace_members.role = 'owner'
             )
             OR EXISTS (
               SELECT 1
               FROM meeting_participants
               WHERE meeting_participants.meeting_id = meeting_reports.meeting_id
                 AND meeting_participants.user_id = $2
             )
           ) AS can_delete
         FROM meeting_reports
         JOIN meetings ON meetings.id = meeting_reports.meeting_id
         WHERE meetings.workspace_id = $1
           AND meeting_reports.id = $3
         FOR UPDATE OF meeting_reports`,
        [workspaceId, currentUserId, reportId]
      );

      if (report === null) {
        throw notFound("Meeting report not found");
      }
      if (!report.can_delete) {
        throw forbidden("Only the workspace owner or a meeting participant can delete this report");
      }
      if (this.isMeetingReportInProgress(report.status)) {
        throw badRequest("Meeting report is still processing");
      }

      const deleted = await transaction.queryOne<{ id: string }>(
        `DELETE FROM meeting_reports
         WHERE id = $1
         RETURNING id`,
        [report.id]
      );
      if (deleted === null) {
        throw notFound("Meeting report not found");
      }

      return { deletedReportId: deleted.id };
    });
  }

  async updateMeetingReportActionItem(
    currentUserId: string,
    workspaceId: string,
    reportId: string,
    actionItemId: string,
    body: unknown
  ): Promise<MeetingReportActionItemMutationPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    const patch = this.normalizeMeetingReportActionItemPatch(body);

    const actionItem = await this.database.transaction(async (transaction) => {
      const current = await this.findMeetingReportActionItemForUpdate(
        transaction,
        workspaceId,
        reportId,
        actionItemId
      );
      this.assertPendingMeetingReportActionItem(current);

      const assigneeUserId = patch.assigneeUserId === undefined
        ? current.assignee_user_id
        : patch.assigneeUserId;
      if (assigneeUserId !== null) {
        await this.assertWorkspaceMember(transaction, workspaceId, assigneeUserId);
      }

      return this.updatePendingMeetingReportActionItem(transaction, current, {
        assigneeUserId,
        description: patch.description ?? current.description,
        priority: patch.priority ?? current.priority,
        title: patch.title ?? current.title
      }, currentUserId);
    });

    return { actionItem: this.mapMeetingReportActionItem(actionItem) };
  }

  async approveMeetingReportActionItem(
    currentUserId: string,
    workspaceId: string,
    reportId: string,
    actionItemId: string
  ): Promise<MeetingReportActionItemMutationPayload> {
    const actionItem = await this.transitionMeetingReportActionItem(
      currentUserId,
      workspaceId,
      reportId,
      actionItemId,
      "APPROVED"
    );
    return { actionItem: this.mapMeetingReportActionItem(actionItem) };
  }

  async dismissMeetingReportActionItem(
    currentUserId: string,
    workspaceId: string,
    reportId: string,
    actionItemId: string
  ): Promise<MeetingReportActionItemMutationPayload> {
    const actionItem = await this.transitionMeetingReportActionItem(
      currentUserId,
      workspaceId,
      reportId,
      actionItemId,
      "DISMISSED"
    );
    return { actionItem: this.mapMeetingReportActionItem(actionItem) };
  }

  async listMeetingReports(
    currentUserId: string,
    workspaceId: string,
    meetingId: string
  ): Promise<MeetingReportListPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    await this.assertMeetingExists(workspaceId, meetingId);
    const reports = await this.listMeetingReportRows(meetingId);

    return {
      nextCursor: null,
      reports: reports.map((report) => this.mapMeetingReportSummary(report))
    };
  }

  async requestReportRegeneration(
    currentUserId: string,
    workspaceId: string,
    reportId: string
  ): Promise<MeetingReportRegenerationPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);

    const result =
      await this.database.transaction<MeetingReportRegenerationTransactionResult>(
        async (transaction) => {
          const report = await this.findMeetingReportForRegeneration(
            transaction,
            workspaceId,
            reportId
          );

          if (report === null) {
            throw notFound("Meeting report not found");
          }

          const audioFileKey = this.assertReportCanBeRegenerated(report);
          const updatedReport = await this.updateMeetingReportForRegeneration(
            transaction,
            report.id
          );

          return {
            payload: {
              report: this.mapMeetingReportSummary(updatedReport)
            },
            job: this.buildMeetingReportJobPayloadFromAudioFileKey(
              updatedReport,
              audioFileKey
            ),
            previousReport: report
          };
        }
      );

    try {
      await this.meetingReportJobService.enqueueMeetingReportJob(result.job);
    } catch (error) {
      await this.restoreMeetingReportAfterRegenerationEnqueueFailure(
        result.previousReport
      );
      throw error;
    }

    return result.payload;
  }

  private assertReportCanBeRegenerated(
    report: MeetingReportRegenerationRow
  ): string {
    if (this.isMeetingReportInProgress(report.status)) {
      throw badRequest("Meeting report is already processing");
    }

    if (report.status === "COMPLETED") {
      throw badRequest("Completed meeting report cannot be regenerated");
    }

    if (report.status !== "FAILED") {
      throw badRequest("Meeting report cannot be regenerated");
    }

    if (
      report.recording_status !== "COMPLETED" ||
      report.recording_audio_file_key === null ||
      !report.recording_audio_file_key.trim()
    ) {
      throw badRequest("Meeting report audio file is unavailable");
    }

    return report.recording_audio_file_key.trim();
  }

  private async findMeetingReportForRegeneration(
    executor: QueryOneExecutor,
    workspaceId: string,
    reportId: string
  ): Promise<MeetingReportRegenerationRow | null> {
    if (!UUID_PATTERN.test(reportId)) {
      return null;
    }

    return executor.queryOne<MeetingReportRegenerationRow>(
      `
        SELECT
          meeting_reports.id,
          meeting_reports.meeting_id,
          meeting_reports.recording_id,
          meeting_reports.status,
          meeting_reports.failed_step,
          meeting_reports.error_message,
          meeting_reports.failure_code,
          meeting_reports.failure_detail,
          meeting_reports.transcript_text,
          meeting_reports.title AS ai_title,
          COALESCE(meeting_reports.user_title, meeting_reports.title) AS title,
          meeting_reports.user_title,
          meeting_reports.summary,
          meeting_reports.discussion_points AS ai_discussion_points,
          COALESCE(meeting_reports.user_discussion_points, meeting_reports.discussion_points) AS discussion_points,
          meeting_reports.user_discussion_points,
          meeting_reports.decisions AS ai_decisions,
          COALESCE(decision_content.decisions, meeting_reports.decisions) AS decisions,
          meeting_reports.content_version,
          meeting_reports.content_edited_by_user_id,
          meeting_reports.content_edited_at,
          meeting_reports.action_item_candidates,
          meeting_reports.retry_count,
          meeting_reports.created_at,
          meeting_reports.updated_at,
          meeting_recordings.status AS recording_status,
          meeting_recordings.audio_file_key AS recording_audio_file_key
        FROM meeting_reports
        JOIN meetings
          ON meetings.id = meeting_reports.meeting_id
        LEFT JOIN LATERAL (
          SELECT string_agg(COALESCE(user_text, text), E'\n' ORDER BY source_index) AS decisions
          FROM meeting_report_decision_items
          WHERE meeting_report_id = meeting_reports.id
        ) AS decision_content ON true
        JOIN meeting_recordings
          ON meeting_recordings.id = meeting_reports.recording_id
          AND meeting_recordings.meeting_id = meeting_reports.meeting_id
        WHERE meetings.workspace_id = $1
          AND meeting_reports.id = $2
        FOR UPDATE OF meeting_reports, meeting_recordings
      `,
      [workspaceId, reportId]
    );
  }

  private async updateMeetingReportForRegeneration(
    executor: QueryOneExecutor,
    reportId: string
  ): Promise<MeetingReportRow> {
    const updatedReport = await executor.queryOne<MeetingReportRow>(
      `
        UPDATE meeting_reports
        SET
          status = 'QUEUED',
          failed_step = NULL,
          error_message = NULL,
          failure_code = NULL,
          failure_detail = NULL,
          transcript_text = NULL,
          title = NULL,
          summary = NULL,
          discussion_points = NULL,
          decisions = NULL,
          action_item_candidates = '[]'::jsonb,
          retry_count = retry_count + 1,
          updated_at = now()
        WHERE id = $1
          AND status = 'FAILED'
        RETURNING
          id,
          meeting_id,
          recording_id,
          status,
          failed_step,
          error_message,
          failure_code,
          failure_detail,
          COALESCE(user_title, title) AS title,
          user_title,
          summary,
          COALESCE(user_discussion_points, discussion_points) AS discussion_points,
          user_discussion_points,
          decisions,
          content_version,
          content_edited_by_user_id,
          content_edited_at,
          action_item_candidates,
          retry_count,
          created_at,
          updated_at
      `,
      [reportId]
    );

    if (updatedReport === null) {
      throw badRequest("Meeting report could not be regenerated");
    }

    return updatedReport;
  }

  private async restoreMeetingReportAfterRegenerationEnqueueFailure(
    report: MeetingReportRegenerationRow
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const restoredReport = await transaction.queryOne<MeetingReportRow>(
        `
          UPDATE meeting_reports
          SET
            status = $2::meeting_report_status,
            failed_step = $3::meeting_report_failed_step,
            error_message = $4,
            failure_code = $5,
            failure_detail = $6::jsonb,
            transcript_text = $7,
            title = $8,
            summary = $9,
            discussion_points = $10,
            decisions = $11,
            action_item_candidates = $12::jsonb,
            retry_count = $13,
            updated_at = now()
          WHERE id = $1
            AND status IN ('PROCESSING', 'QUEUED', 'TRANSCRIBING', 'SUMMARIZING')
          RETURNING
            id,
            meeting_id,
            recording_id,
            status,
            failed_step,
            error_message,
            failure_code,
            failure_detail,
            title,
            user_title,
            summary,
            discussion_points,
            decisions,
            user_discussion_points,
            content_version,
            content_edited_by_user_id,
            content_edited_at,
            action_item_candidates,
            retry_count,
            created_at,
            updated_at
        `,
        [
          report.id,
          report.status,
          report.failed_step,
          report.error_message,
          report.failure_code,
          report.failure_detail == null ? null : JSON.stringify(report.failure_detail),
          report.transcript_text,
          report.ai_title,
          report.summary,
          report.ai_discussion_points,
          report.ai_decisions,
          JSON.stringify(report.action_item_candidates ?? []),
          Number(report.retry_count)
        ]
      );

      if (restoredReport === null) {
        throw badRequest("Meeting report regeneration could not be restored");
      }
    });
  }

  private buildMeetingReportJobPayloadFromAudioFileKey(
    report: MeetingReportRow,
    audioFileKey: string
  ): MeetingReportJobPayload {
    return {
      jobType: "meeting_report",
      reportId: report.id,
      meetingId: report.meeting_id,
      recordingId: report.recording_id,
      audioFileKey,
      retryCount: Number(report.retry_count)
    };
  }

  private async createStartedMeeting(
    transaction: DatabaseTransaction,
    workspaceId: string,
    roomKey: string,
    currentUserId: string,
    recordingConsent: RecordingConsentDraft | null
  ): Promise<StartMeetingPayload> {
    await this.ensureWorkspaceRecordingConsent(
      transaction,
      workspaceId,
      currentUserId,
      recordingConsent
    );

    const startedMeeting = await transaction.queryOne<StartMeetingRow>(
      `
        WITH generated AS (
          SELECT gen_random_uuid() AS meeting_id
        ),
        inserted_meeting AS (
          INSERT INTO meetings (
            id,
            workspace_id,
            room_key,
            livekit_room_name,
            created_by_id
          )
          SELECT
            generated.meeting_id,
            $1::uuid,
            $2,
            'meeting-' || generated.meeting_id::text,
            $3::uuid
          FROM generated
          RETURNING *
        ),
        inserted_participant AS (
          INSERT INTO meeting_participants (
            meeting_id,
            user_id,
            livekit_identity
          )
          SELECT
            inserted_meeting.id,
            $3::uuid,
            'meeting-' || inserted_meeting.id::text || '-user-' || ($3::uuid)::text
          FROM inserted_meeting
          RETURNING *
        )
        SELECT
          inserted_meeting.id AS meeting_id,
          inserted_meeting.workspace_id AS meeting_workspace_id,
          inserted_meeting.room_key AS meeting_room_key,
          inserted_meeting.livekit_room_name AS meeting_livekit_room_name,
          inserted_meeting.created_by_id AS meeting_created_by_id,
          inserted_meeting.ended_by_id AS meeting_ended_by_id,
          inserted_meeting.started_at AS meeting_started_at,
          inserted_meeting.ended_at AS meeting_ended_at,
          inserted_meeting.created_at AS meeting_created_at,
          inserted_meeting.updated_at AS meeting_updated_at,
          inserted_participant.id AS participant_id,
          inserted_participant.meeting_id AS participant_meeting_id,
          inserted_participant.user_id AS participant_user_id,
          inserted_participant.livekit_identity AS participant_livekit_identity,
          inserted_participant.joined_at AS participant_joined_at,
          inserted_participant.left_at AS participant_left_at,
          users.name AS participant_user_name,
          users.avatar_url AS participant_user_avatar_url
        FROM inserted_meeting
        JOIN inserted_participant
          ON inserted_participant.meeting_id = inserted_meeting.id
        JOIN users
          ON users.id = inserted_participant.user_id
      `,
      [workspaceId, roomKey, currentUserId]
    );

    if (!startedMeeting) {
      throw badRequest("Meeting could not be started");
    }

    const livekit = await this.liveKitTokenService.createJoinToken({
      livekitRoomName: startedMeeting.meeting_livekit_room_name,
      livekitIdentity: startedMeeting.participant_livekit_identity,
      participantName: startedMeeting.participant_user_name
    });

    return this.mapStartMeeting(startedMeeting, livekit);
  }

  private async publishMeetingStarted(
    workspaceId: string,
    meetingId: string
  ): Promise<void> {
    await this.publishMeetingStateEvent({
      workspaceId,
      meetingId,
      change: "started"
    });
  }

  private async currentMeetingPayload(
    workspaceId: string,
    roomKey: string
  ): Promise<CurrentMeetingPayload> {
    const currentMeeting = await this.findCurrentMeeting(workspaceId, roomKey);

    if (!currentMeeting) {
      return {
        meeting: null,
        currentRecording: null,
        activeParticipantCount: 0
      };
    }

    return {
      meeting: this.mapMeeting(currentMeeting),
      currentRecording: this.mapNullableCurrentRecording(currentMeeting),
      activeParticipantCount: Number(currentMeeting.active_participant_count)
    };
  }

  private async assertWorkspaceAccess(
    currentUserId: string,
    workspaceId: string
  ): Promise<void> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
  }

  private async assertWorkspaceOwnerAccess(
    currentUserId: string,
    workspaceId: string
  ): Promise<void> {
    await this.workspaceService.assertWorkspaceOwnerAccess(
      currentUserId,
      workspaceId
    );
  }

  private meetingAlreadyInProgress() {
    return new ApiError(
      HttpStatus.BAD_REQUEST,
      MEETING_ALREADY_IN_PROGRESS_ERROR_CODE,
      MEETING_ALREADY_IN_PROGRESS_MESSAGE
    );
  }

  private activeMeetingParticipationExists() {
    return conflict(ACTIVE_MEETING_PARTICIPATION_EXISTS_MESSAGE);
  }

  private async assertMeetingExists(
    workspaceId: string,
    meetingId: string
  ): Promise<MeetingRow> {
    const meeting = await this.findMeetingById(this.database, workspaceId, meetingId);

    if (!meeting) {
      throw notFound("Meeting not found");
    }

    return meeting;
  }

  private async requireActiveMeetingRoom(
    executor: QueryOneExecutor,
    workspaceId: string,
    meetingRoomId: string,
    options: { lockRoom?: boolean } = {}
  ): Promise<MeetingRoomRow> {
    const room = await this.findActiveMeetingRoom(
      executor,
      workspaceId,
      meetingRoomId,
      options
    );
    if (!room) {
      throw notFound("Meeting room not found");
    }

    return room;
  }

  private async findActiveMeetingRoom(
    executor: QueryOneExecutor,
    workspaceId: string,
    meetingRoomId: string,
    options: { lockRoom?: boolean } = {}
  ): Promise<MeetingRoomRow | null> {
    if (!UUID_PATTERN.test(meetingRoomId)) {
      return null;
    }

    return executor.queryOne<MeetingRoomRow>(
      `
        SELECT id, workspace_id, room_key, name, created_by_id, created_at, updated_at
        FROM meeting_rooms
        WHERE workspace_id = $1
          AND id = $2::uuid
          AND archived_at IS NULL
        ${options.lockRoom === true ? "FOR UPDATE" : ""}
      `,
      [workspaceId, meetingRoomId]
    );
  }

  private async isDefaultMeetingRoom(
    executor: QueryOneExecutor,
    workspaceId: string,
    meetingRoomId: string
  ): Promise<boolean> {
    const defaultRoom = await executor.queryOne<{ id: string }>(
      `
        SELECT id
        FROM meeting_rooms
        WHERE workspace_id = $1
          AND archived_at IS NULL
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      `,
      [workspaceId]
    );

    return defaultRoom?.id === meetingRoomId;
  }

  private async assertNoOtherActiveMeetingParticipant(
    transaction: DatabaseTransaction,
    currentUserId: string,
    allowedMeetingId?: string
  ): Promise<void> {
    await transaction.execute(
      "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
      [currentUserId]
    );

    const activeParticipant = await transaction.queryOne<{ meeting_id: string }>(
      `
        SELECT meeting_participants.meeting_id
        FROM meeting_participants
        JOIN meetings
          ON meetings.id = meeting_participants.meeting_id
        WHERE meeting_participants.user_id = $1::uuid
          AND meeting_participants.left_at IS NULL
          AND meetings.ended_at IS NULL
          ${allowedMeetingId ? "AND meeting_participants.meeting_id <> $2::uuid" : ""}
        ORDER BY meeting_participants.joined_at DESC, meeting_participants.meeting_id ASC
        LIMIT 1
        FOR UPDATE OF meeting_participants
      `,
      allowedMeetingId ? [currentUserId, allowedMeetingId] : [currentUserId]
    );

    if (activeParticipant) {
      throw this.activeMeetingParticipationExists();
    }
  }

  private async findCurrentMeeting(
    workspaceId: string,
    roomKey: string,
    executor: QueryOneExecutor = this.database
  ): Promise<CurrentMeetingRow | null> {
    return executor.queryOne<CurrentMeetingRow>(
      `
        SELECT
          meetings.id,
          meetings.workspace_id,
          meetings.room_key,
          meetings.livekit_room_name,
          meetings.created_by_id,
          meetings.ended_by_id,
          meetings.started_at,
          meetings.ended_at,
          meetings.created_at,
          meetings.updated_at,
          current_recording.id AS recording_id,
          current_recording.meeting_id AS recording_meeting_id,
          current_recording.livekit_egress_id AS recording_livekit_egress_id,
          current_recording.status AS recording_status,
          current_recording.audio_file_url AS recording_audio_file_url,
          current_recording.audio_file_key AS recording_audio_file_key,
          current_recording.duration_sec AS recording_duration_sec,
          current_recording.file_size_bytes AS recording_file_size_bytes,
          current_recording.started_at AS recording_started_at,
          current_recording.ended_at AS recording_ended_at,
          current_recording.error_message AS recording_error_message,
          COALESCE(active_participants.count, 0)::int AS active_participant_count
        FROM meetings
        LEFT JOIN LATERAL (
          SELECT
            meeting_recordings.id,
            meeting_recordings.meeting_id,
            meeting_recordings.livekit_egress_id,
            meeting_recordings.status,
            meeting_recordings.audio_file_url,
            meeting_recordings.audio_file_key,
            meeting_recordings.duration_sec,
            meeting_recordings.file_size_bytes,
            meeting_recordings.started_at,
            meeting_recordings.ended_at,
            meeting_recordings.error_message
          FROM meeting_recordings
          WHERE meeting_recordings.meeting_id = meetings.id
            AND meeting_recordings.status = 'RUNNING'
          ORDER BY meeting_recordings.started_at DESC, meeting_recordings.id ASC
          LIMIT 1
        ) AS current_recording ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS count
          FROM meeting_participants
          WHERE meeting_participants.meeting_id = meetings.id
            AND meeting_participants.left_at IS NULL
        ) AS active_participants ON true
        WHERE meetings.workspace_id = $1
          AND meetings.room_key = $2
          AND meetings.ended_at IS NULL
        ORDER BY meetings.started_at DESC, meetings.id ASC
        LIMIT 1
      `,
      [workspaceId, roomKey]
    );
  }

  private async findMeetingById(
    executor: QueryOneExecutor,
    workspaceId: string,
    meetingId: string,
    options: { lockMeeting?: boolean } = {}
  ): Promise<CurrentMeetingRow | null> {
    if (!UUID_PATTERN.test(meetingId)) {
      return null;
    }

    return executor.queryOne<CurrentMeetingRow>(
      `
        SELECT
          meetings.id,
          meetings.workspace_id,
          meetings.room_key,
          meetings.livekit_room_name,
          meetings.created_by_id,
          meetings.ended_by_id,
          meetings.started_at,
          meetings.ended_at,
          meetings.created_at,
          meetings.updated_at,
          current_recording.id AS recording_id,
          current_recording.meeting_id AS recording_meeting_id,
          current_recording.livekit_egress_id AS recording_livekit_egress_id,
          current_recording.status AS recording_status,
          current_recording.audio_file_url AS recording_audio_file_url,
          current_recording.audio_file_key AS recording_audio_file_key,
          current_recording.duration_sec AS recording_duration_sec,
          current_recording.file_size_bytes AS recording_file_size_bytes,
          current_recording.started_at AS recording_started_at,
          current_recording.ended_at AS recording_ended_at,
          current_recording.error_message AS recording_error_message,
          COALESCE(active_participants.count, 0)::int AS active_participant_count
        FROM meetings
        LEFT JOIN LATERAL (
          SELECT
            meeting_recordings.id,
            meeting_recordings.meeting_id,
            meeting_recordings.livekit_egress_id,
            meeting_recordings.status,
            meeting_recordings.audio_file_url,
            meeting_recordings.audio_file_key,
            meeting_recordings.duration_sec,
            meeting_recordings.file_size_bytes,
            meeting_recordings.started_at,
            meeting_recordings.ended_at,
            meeting_recordings.error_message
          FROM meeting_recordings
          WHERE meeting_recordings.meeting_id = meetings.id
            AND meeting_recordings.status = 'RUNNING'
          ORDER BY meeting_recordings.started_at DESC, meeting_recordings.id ASC
          LIMIT 1
        ) AS current_recording ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS count
          FROM meeting_participants
          WHERE meeting_participants.meeting_id = meetings.id
            AND meeting_participants.left_at IS NULL
        ) AS active_participants ON true
        WHERE meetings.workspace_id = $1
          AND meetings.id = $2
        LIMIT 1
        ${options.lockMeeting === true ? "FOR UPDATE OF meetings" : ""}
      `,
      [workspaceId, meetingId]
    );
  }

  private async findActiveMeetingByLiveKitRoomName(
    executor: QueryOneExecutor,
    liveKitRoomName: string
  ): Promise<CurrentMeetingRow | null> {
    return executor.queryOne<CurrentMeetingRow>(
      `
        SELECT
          meetings.id,
          meetings.workspace_id,
          meetings.room_key,
          meetings.livekit_room_name,
          meetings.created_by_id,
          meetings.ended_by_id,
          meetings.started_at,
          meetings.ended_at,
          meetings.created_at,
          meetings.updated_at,
          current_recording.id AS recording_id,
          current_recording.meeting_id AS recording_meeting_id,
          current_recording.livekit_egress_id AS recording_livekit_egress_id,
          current_recording.status AS recording_status,
          current_recording.audio_file_url AS recording_audio_file_url,
          current_recording.audio_file_key AS recording_audio_file_key,
          current_recording.duration_sec AS recording_duration_sec,
          current_recording.file_size_bytes AS recording_file_size_bytes,
          current_recording.started_at AS recording_started_at,
          current_recording.ended_at AS recording_ended_at,
          current_recording.error_message AS recording_error_message,
          active_participants.count AS active_participant_count
        FROM meetings
        LEFT JOIN LATERAL (
          SELECT
            id,
            meeting_id,
            livekit_egress_id,
            status,
            audio_file_url,
            audio_file_key,
            duration_sec,
            file_size_bytes,
            started_at,
            ended_at,
            error_message
          FROM meeting_recordings
          WHERE meeting_recordings.meeting_id = meetings.id
            AND meeting_recordings.status = 'RUNNING'
          ORDER BY meeting_recordings.started_at DESC, meeting_recordings.id ASC
          LIMIT 1
        ) AS current_recording ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS count
          FROM meeting_participants
          WHERE meeting_participants.meeting_id = meetings.id
            AND meeting_participants.left_at IS NULL
        ) AS active_participants ON true
        WHERE meetings.livekit_room_name = $1
          AND meetings.ended_at IS NULL
        LIMIT 1
        FOR UPDATE OF meetings
      `,
      [liveKitRoomName]
    );
  }

  private async listRecordingRows(meetingId: string): Promise<RecordingRow[]> {
    return this.database.query<RecordingRow>(
      `
        SELECT
          id,
          meeting_id,
          livekit_egress_id,
          status,
          audio_file_url,
          audio_file_key,
          duration_sec,
          file_size_bytes,
          started_at,
          ended_at,
          error_message
        FROM meeting_recordings
        WHERE meeting_id = $1
        ORDER BY started_at DESC, id ASC
      `,
      [meetingId]
    );
  }

  private async findRunningRecording(
    executor: QueryOneExecutor,
    meetingId: string,
    options: { lockRecording?: boolean } = {}
  ): Promise<RecordingRow | null> {
    return executor.queryOne<RecordingRow>(
      `
        SELECT
          id,
          meeting_id,
          livekit_egress_id,
          status,
          audio_file_url,
          audio_file_key,
          duration_sec,
          file_size_bytes,
          started_at,
          ended_at,
          error_message
        FROM meeting_recordings
        WHERE meeting_id = $1
          AND status = 'RUNNING'
        ORDER BY started_at DESC, id ASC
        LIMIT 1
        ${options.lockRecording === true ? "FOR UPDATE" : ""}
      `,
      [meetingId]
    );
  }

  private async findRecordingById(
    executor: QueryOneExecutor,
    meetingId: string,
    recordingId: string,
    options: { lockRecording?: boolean } = {}
  ): Promise<RecordingRow | null> {
    if (!UUID_PATTERN.test(recordingId)) {
      return null;
    }

    return executor.queryOne<RecordingRow>(
      `
        SELECT
          id,
          meeting_id,
          livekit_egress_id,
          status,
          audio_file_url,
          audio_file_key,
          duration_sec,
          file_size_bytes,
          started_at,
          ended_at,
          error_message
        FROM meeting_recordings
        WHERE meeting_id = $1
          AND id = $2
        LIMIT 1
        ${options.lockRecording === true ? "FOR UPDATE" : ""}
      `,
      [meetingId, recordingId]
    );
  }

  private async generateId(executor: QueryOneExecutor): Promise<string> {
    const generated = await executor.queryOne<GeneratedIdRow>(
      "SELECT gen_random_uuid()::text AS id"
    );

    if (!generated) {
      throw badRequest("Identifier could not be generated");
    }

    return generated.id;
  }

  private async insertRunningRecording(
    executor: QueryOneExecutor,
    input: {
      recordingId: string;
      meetingId: string;
      livekitEgressId: string | null;
      audioFileKey: string;
    }
  ): Promise<RecordingRow> {
    const recording = await executor.queryOne<RecordingRow>(
      `
        INSERT INTO meeting_recordings (
          id,
          meeting_id,
          livekit_egress_id,
          status,
          audio_file_url,
          audio_file_key
        )
        VALUES ($1, $2, $3, 'RUNNING', NULL, $4)
        RETURNING
          id,
          meeting_id,
          livekit_egress_id,
          status,
          audio_file_url,
          audio_file_key,
          duration_sec,
          file_size_bytes,
          started_at,
          ended_at,
          error_message
      `,
      [
        input.recordingId,
        input.meetingId,
        input.livekitEgressId,
        input.audioFileKey
      ]
    );

    if (!recording) {
      throw badRequest("Recording could not be started");
    }

    return recording;
  }

  private async updateRecordingLiveKitEgressId(
    executor: QueryOneExecutor,
    recording: RecordingRow,
    livekitEgressId: string
  ): Promise<RecordingRow> {
    const updatedRecording = await executor.queryOne<RecordingRow>(
      `
        UPDATE meeting_recordings
        SET
          livekit_egress_id = $2,
          updated_at = now()
        WHERE id = $1
          AND status = 'RUNNING'
          AND livekit_egress_id IS NULL
        RETURNING
          id,
          meeting_id,
          livekit_egress_id,
          status,
          audio_file_url,
          audio_file_key,
          duration_sec,
          file_size_bytes,
          started_at,
          ended_at,
          error_message
      `,
      [recording.id, livekitEgressId]
    );

    if (!updatedRecording) {
      throw badRequest("Recording Egress id could not be saved");
    }

    return updatedRecording;
  }

  private async insertFailedRecording(
    executor: QueryOneExecutor,
    input: {
      recordingId: string;
      meetingId: string;
      audioFileKey: string;
      errorMessage: string;
    }
  ): Promise<RecordingRow> {
    const recording = await executor.queryOne<RecordingRow>(
      `
        INSERT INTO meeting_recordings (
          id,
          meeting_id,
          status,
          audio_file_url,
          audio_file_key,
          ended_at,
          error_message
        )
        VALUES ($1, $2, 'FAILED', NULL, $3, now(), $4)
        RETURNING
          id,
          meeting_id,
          livekit_egress_id,
          status,
          audio_file_url,
          audio_file_key,
          duration_sec,
          file_size_bytes,
          started_at,
          ended_at,
          error_message
      `,
      [input.recordingId, input.meetingId, input.audioFileKey, input.errorMessage]
    );

    if (!recording) {
      throw badRequest("Recording failure could not be saved");
    }

    return recording;
  }

  private async updateRecordingCompleted(
    executor: QueryOneExecutor,
    recording: RecordingRow,
    result: StopLiveKitEgressResult
  ): Promise<RecordingRow> {
    const updatedRecording = await executor.queryOne<RecordingRow>(
      `
        UPDATE meeting_recordings
        SET
          status = 'COMPLETED',
          audio_file_url = NULL,
          audio_file_key = COALESCE($2, audio_file_key),
          duration_sec = COALESCE(
            $3,
            GREATEST(1, EXTRACT(EPOCH FROM (now() - started_at))::int)
          ),
          file_size_bytes = $4,
          ended_at = now(),
          error_message = NULL,
          updated_at = now()
        WHERE id = $1
          AND status = 'RUNNING'
        RETURNING
          id,
          meeting_id,
          livekit_egress_id,
          status,
          audio_file_url,
          audio_file_key,
          duration_sec,
          file_size_bytes,
          started_at,
          ended_at,
          error_message
      `,
      [
        recording.id,
        result.audioFileKey ?? recording.audio_file_key,
        result.durationSec,
        result.fileSizeBytes
      ]
    );

    if (!updatedRecording) {
      throw badRequest("Recording could not be completed");
    }

    return updatedRecording;
  }

  private async prepareReportForStoppedRecording(
    executor: QueryOneExecutor,
    recording: RecordingRow
  ): Promise<MeetingReportPreparation> {
    if (recording.status !== "COMPLETED") {
      return {
        report: null,
        job: null
      };
    }

    if (recording.duration_sec === null || Number(recording.duration_sec) <= 60) {
      return {
        report: null,
        job: null
      };
    }

    const existingReport = await this.findMeetingReportByRecordingId(
      executor,
      recording.meeting_id,
      recording.id
    );
    if (existingReport !== null) {
      return {
        report: existingReport,
        job: null
      };
    }

    const result = await this.insertProcessingMeetingReport(executor, recording);
    const job =
      result.inserted && recording.audio_file_key !== null
        ? this.buildMeetingReportJobPayload(result.report, recording)
        : null;

    if (job !== null) {
      await this.insertMeetingReportOutbox(executor, job);
    }

    return {
      report: result.report,
      job
    };
  }

  private async findMeetingReportByRecordingId(
    executor: QueryOneExecutor,
    meetingId: string,
    recordingId: string
  ): Promise<MeetingReportRow | null> {
    return executor.queryOne<MeetingReportRow>(
      `
        SELECT
          id,
          meeting_id,
          recording_id,
          status,
          failed_step,
          error_message,
          title,
          user_title,
          summary,
          discussion_points,
          decisions,
          user_discussion_points,
          content_version,
          content_edited_by_user_id,
          content_edited_at,
          action_item_candidates,
          retry_count,
          created_at,
          updated_at
        FROM meeting_reports
        WHERE meeting_id = $1
          AND recording_id = $2
        LIMIT 1
      `,
      [meetingId, recordingId]
    );
  }

  private async insertProcessingMeetingReport(
    executor: QueryOneExecutor,
    recording: RecordingRow
  ): Promise<MeetingReportInsertResult> {
    const insertedReport = await executor.queryOne<MeetingReportRow>(
      `
        INSERT INTO meeting_reports (
          meeting_id,
          recording_id,
          status
        )
        VALUES ($1, $2, 'QUEUED')
        ON CONFLICT (recording_id) DO NOTHING
        RETURNING
          id,
          meeting_id,
          recording_id,
          status,
          failed_step,
          error_message,
          title,
          user_title,
          summary,
          discussion_points,
          decisions,
          user_discussion_points,
          content_version,
          content_edited_by_user_id,
          content_edited_at,
          action_item_candidates,
          retry_count,
          created_at,
          updated_at
      `,
      [recording.meeting_id, recording.id]
    );

    if (insertedReport !== null) {
      return {
        report: insertedReport,
        inserted: true
      };
    }

    const existingReport = await this.findMeetingReportByRecordingId(
      executor,
      recording.meeting_id,
      recording.id
    );
    if (existingReport === null) {
      throw badRequest("Meeting report could not be created");
    }

    return {
      report: existingReport,
      inserted: false
    };
  }

  private buildMeetingReportJobPayload(
    report: MeetingReportRow,
    recording: RecordingRow
  ): MeetingReportJobPayload {
    if (recording.audio_file_key === null) {
      throw badRequest("Meeting report job could not be created");
    }

    return this.buildMeetingReportJobPayloadFromAudioFileKey(
      report,
      recording.audio_file_key
    );
  }

  private async enqueueMeetingReportJob(
    job: MeetingReportJobPayload | null
  ): Promise<void> {
    if (job === null) {
      return;
    }

    await this.meetingReportJobService.enqueueMeetingReportJob(job);
  }

  private async insertMeetingReportOutbox(
    executor: QueryOneExecutor,
    job: MeetingReportJobPayload
  ): Promise<void> {
    const outbox = await executor.queryOne<{ id: string }>(
      `
        INSERT INTO meeting_report_outbox (
          report_id,
          meeting_id,
          recording_id,
          audio_file_key
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (report_id) DO NOTHING
        RETURNING id
      `,
      [job.reportId, job.meetingId, job.recordingId, job.audioFileKey]
    );

    if (outbox === null) {
      const existing = await executor.queryOne<{ id: string }>(
        `
          SELECT id
          FROM meeting_report_outbox
          WHERE report_id = $1
          LIMIT 1
        `,
        [job.reportId]
      );

      if (existing === null) {
        throw badRequest("Meeting report outbox could not be saved");
      }
    }
  }

  private async publishMeetingReportOutbox(
    job: MeetingReportJobPayload | null
  ): Promise<void> {
    if (job === null) {
      return;
    }

    try {
      await this.enqueueMeetingReportJob(job);
      const outbox = await this.database.queryOne<{ id: string }>(
        `
          UPDATE meeting_report_outbox
          SET
            status = 'delivered',
            delivered_at = now(),
            error_code = NULL,
            error_message = NULL,
            updated_at = now()
          WHERE report_id = $1
            AND status = 'pending'
          RETURNING id
        `,
        [job.reportId]
      );
      if (outbox !== null) {
        this.logger.log(
          `MeetingReport outbox event=fast_path_delivered outbox_id=${outbox.id} report_id=${job.reportId} meeting_id=${job.meetingId} recording_id=${job.recordingId}`
        );
      }
    } catch {
      // Keep the committed pending intent for MP-05 dispatcher retry.
      this.logger.warn(
        `MeetingReport outbox event=fast_path_pending report_id=${job.reportId} meeting_id=${job.meetingId} recording_id=${job.recordingId} failure_step=none`
      );
    }
  }

  private async publishMeetingReportEvent(reportId: string | undefined): Promise<void> {
    if (!reportId) return;
    await this.meetingReportRealtimePublisher?.publishReportUpdatedSafely(reportId);
  }

  private async publishMeetingStateEvent(
    input: MeetingStateRealtimeEventInput
  ): Promise<void> {
    if (input.change === "ended") {
      try {
        await this.meetingNotificationService.cancelPendingInvitationsForMeeting(
          input.meetingId
        );
      } catch {
        this.logger.warn(
          `Meeting invitation cancellation failed meeting_id=${input.meetingId}`
        );
      }
    }
    await this.meetingStateRealtimePublisher?.publishStateUpdatedSafely(input);
  }

  private async publishMeetingStateEvents(
    events: MeetingStateRealtimeEventInput[]
  ): Promise<void> {
    for (const event of events) {
      await this.publishMeetingStateEvent(event);
    }
  }

  private async restoreLeaveMeetingAfterReportEnqueueFailure(input: {
    workspaceId: string;
    meetingId: string;
    currentUserId: string;
    reportId: string;
  }): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.queryOne(
        `
          UPDATE meeting_reports
          SET
            status = 'FAILED',
            failed_step = 'STT',
            error_message = 'Meeting report job could not be enqueued',
            transcript_text = NULL,
            title = NULL,
            summary = NULL,
            discussion_points = NULL,
            decisions = NULL,
            action_item_candidates = '[]'::jsonb,
            updated_at = now()
          WHERE id = $1
            AND status IN ('PROCESSING', 'QUEUED', 'TRANSCRIBING', 'SUMMARIZING')
          RETURNING id
        `,
        [input.reportId]
      );

      await transaction.queryOne(
        `
          UPDATE meeting_participants
          SET
            left_at = NULL,
            updated_at = now()
          WHERE meeting_id = $1
            AND user_id = $2
            AND left_at IS NOT NULL
          RETURNING id
        `,
        [input.meetingId, input.currentUserId]
      );

      await transaction.queryOne(
        `
          UPDATE meetings
          SET
            ended_at = NULL,
            updated_at = now()
          WHERE workspace_id = $1
            AND id = $2
            AND ended_at IS NOT NULL
          RETURNING id
        `,
        [input.workspaceId, input.meetingId]
      );
    });
  }

  private async updateRecordingFailed(
    executor: QueryOneExecutor,
    recording: RecordingRow,
    errorMessage: string
  ): Promise<RecordingRow> {
    const updatedRecording = await executor.queryOne<RecordingRow>(
      `
        UPDATE meeting_recordings
        SET
          status = 'FAILED',
          ended_at = now(),
          error_message = $2,
          updated_at = now()
        WHERE id = $1
          AND status = 'RUNNING'
        RETURNING
          id,
          meeting_id,
          livekit_egress_id,
          status,
          audio_file_url,
          audio_file_key,
          duration_sec,
          file_size_bytes,
          started_at,
          ended_at,
          error_message
      `,
      [recording.id, errorMessage]
    );

    if (!updatedRecording) {
      throw badRequest("Recording could not be failed");
    }

    return updatedRecording;
  }

  private async listMeetingReportRows(
    meetingId: string
  ): Promise<MeetingReportRow[]> {
    return this.database.query<MeetingReportRow>(
      `
        SELECT
          meeting_reports.id, meeting_reports.meeting_id, meeting_reports.recording_id,
          meeting_reports.status, meeting_reports.failed_step, meeting_reports.error_message,
          COALESCE(meeting_reports.user_title, meeting_reports.title) AS title,
          meeting_reports.user_title,
          meeting_reports.summary,
          COALESCE(meeting_reports.user_discussion_points, meeting_reports.discussion_points) AS discussion_points,
          meeting_reports.user_discussion_points,
          COALESCE(decision_content.decisions, meeting_reports.decisions) AS decisions,
          meeting_reports.content_version, meeting_reports.content_edited_by_user_id,
          meeting_reports.content_edited_at,
          meeting_reports.action_item_candidates, meeting_reports.retry_count,
          meeting_reports.created_at, meeting_reports.updated_at,
          ${this.meetingReportParticipantSummaryColumns()}
        FROM meeting_reports
        LEFT JOIN LATERAL (
          SELECT string_agg(COALESCE(user_text, text), E'\n' ORDER BY source_index) AS decisions
          FROM meeting_report_decision_items
          WHERE meeting_report_id = meeting_reports.id
        ) AS decision_content ON true
        ${this.meetingReportParticipantSummaryJoin("meeting_reports")}
        WHERE meeting_reports.meeting_id = $1
        ORDER BY meeting_reports.created_at DESC, meeting_reports.id ASC
      `,
      [meetingId]
    );
  }

  private async listWorkspaceMeetingReportRows(
    workspaceId: string,
    currentUserId: string,
    status: MeetingReportStatus | null,
    limit: number,
    filters: {
      cursor: MeetingReportCursor | null;
      from: string | null;
      searchQuery: string | null;
      to: string | null;
      roomName?: string | null;
    }
  ): Promise<{ nextCursor: string | null; reports: MeetingReportRow[] }> {
    const values: unknown[] = [workspaceId, currentUserId];
    const statusCondition =
      status === null
        ? ""
        : `AND meeting_reports.status = $${values.push(status)}`;
    const searchCondition =
      filters.searchQuery === null
        ? ""
        : `AND to_tsvector('simple', concat_ws(' ', COALESCE(meeting_reports.user_title, meeting_reports.title, ''), COALESCE(meeting_reports.summary, ''), COALESCE(meeting_reports.user_discussion_points, meeting_reports.discussion_points, ''), COALESCE((SELECT string_agg(COALESCE(user_text, text), E'\n' ORDER BY source_index) FROM meeting_report_decision_items WHERE meeting_report_id = meeting_reports.id), meeting_reports.decisions, ''), COALESCE(meeting_reports.action_item_candidates::text, ''), COALESCE(meeting_reports.error_message, ''))) @@ websearch_to_tsquery('simple', $${values.push(filters.searchQuery)})`;
    const fromCondition =
      filters.from === null
        ? ""
        : `AND meeting_reports.created_at >= $${values.push(filters.from)}::timestamptz`;
    const toCondition =
      filters.to === null
        ? ""
        : `AND meeting_reports.created_at < $${values.push(filters.to)}::timestamptz`;
    const roomNameCondition =
      filters.roomName === null || filters.roomName === undefined
        ? ""
        : `AND lower(regexp_replace(BTRIM(meeting_rooms.name), '\\s+', ' ', 'g')) = $${values.push(filters.roomName)}`;
    const cursorCondition =
      filters.cursor === null
        ? ""
        : (() => {
            const createdAtParameter = `$${values.push(filters.cursor.createdAt)}`;
            const idParameter = `$${values.push(filters.cursor.id)}`;
            return `AND (meeting_reports.created_at < ${createdAtParameter}::timestamptz OR (meeting_reports.created_at = ${createdAtParameter}::timestamptz AND meeting_reports.id > ${idParameter}::uuid))`;
          })();
    const limitParameter = `$${values.push(limit + 1)}`;

    const rows = await this.database.query<MeetingReportRow>(
      `
        SELECT
          meeting_reports.id,
          meeting_reports.meeting_id,
          meeting_reports.recording_id,
          meeting_reports.status,
          meeting_reports.failed_step,
          meeting_reports.error_message,
          COALESCE(meeting_reports.user_title, meeting_reports.title) AS title,
          meeting_reports.user_title,
          meeting_reports.summary,
          COALESCE(meeting_reports.user_discussion_points, meeting_reports.discussion_points) AS discussion_points,
          meeting_reports.user_discussion_points,
          COALESCE(decision_content.decisions, meeting_reports.decisions) AS decisions,
          meeting_reports.content_version,
          meeting_reports.content_edited_by_user_id,
          meeting_reports.content_edited_at,
          meeting_reports.action_item_candidates,
          meeting_reports.retry_count,
          meeting_reports.created_at,
          meeting_reports.updated_at,
          extraction.status AS action_item_extraction_status,
          extraction.failure_code AS action_item_extraction_failure_code,
          (
            EXISTS (
              SELECT 1
              FROM workspace_members
              WHERE workspace_members.workspace_id = meetings.workspace_id
                AND workspace_members.user_id = $2
                AND workspace_members.role = 'owner'
            )
            OR EXISTS (
              SELECT 1
              FROM meeting_participants
              WHERE meeting_participants.meeting_id = meeting_reports.meeting_id
                AND meeting_participants.user_id = $2
            )
          ) AS can_delete,
          (
            EXISTS (
              SELECT 1
              FROM workspace_members
              WHERE workspace_members.workspace_id = meetings.workspace_id
                AND workspace_members.user_id = $2
                AND workspace_members.role = 'owner'
            )
            OR EXISTS (
              SELECT 1
              FROM meeting_participants
              WHERE meeting_participants.meeting_id = meeting_reports.meeting_id
                AND meeting_participants.user_id = $2
            )
          ) AS can_edit,
          ${this.meetingReportParticipantSummaryColumns()}
        FROM meeting_reports
        JOIN meetings
          ON meetings.id = meeting_reports.meeting_id
        LEFT JOIN meeting_rooms
          ON meeting_rooms.workspace_id = meetings.workspace_id
          AND meeting_rooms.room_key = meetings.room_key
        LEFT JOIN meeting_report_action_item_extractions AS extraction
          ON extraction.meeting_report_id = meeting_reports.id
        LEFT JOIN LATERAL (
          SELECT string_agg(COALESCE(user_text, text), E'\n' ORDER BY source_index) AS decisions
          FROM meeting_report_decision_items
          WHERE meeting_report_id = meeting_reports.id
        ) AS decision_content ON true
        ${this.meetingReportParticipantSummaryJoin("meeting_reports")}
        WHERE meetings.workspace_id = $1
          ${statusCondition}
          ${searchCondition}
          ${fromCondition}
          ${toCondition}
          ${roomNameCondition}
          ${cursorCondition}
        ORDER BY meeting_reports.created_at DESC, meeting_reports.id ASC
        LIMIT ${limitParameter}
      `,
      values
    );
    const reports = rows.slice(0, limit);
    const lastReport = reports.at(-1);

    return {
      nextCursor:
        rows.length > limit && lastReport
          ? this.encodeMeetingReportCursor({
              createdAt: this.toIsoString(lastReport.created_at),
              id: lastReport.id
            })
          : null,
      reports
    };
  }

  private async findMeetingReportDetailById(
    workspaceId: string,
    currentUserId: string,
    reportId: string
  ): Promise<MeetingReportDetailRow | null> {
    if (!UUID_PATTERN.test(reportId)) {
      return null;
    }

    return this.database.queryOne<MeetingReportDetailRow>(
      `
        SELECT
          meeting_reports.id,
          meeting_reports.meeting_id,
          meeting_reports.recording_id,
          meeting_reports.status,
          meeting_reports.failed_step,
          meeting_reports.error_message,
          meeting_reports.transcript_text,
          COALESCE(meeting_reports.user_title, meeting_reports.title) AS title,
          meeting_reports.user_title,
          meeting_reports.summary,
          COALESCE(meeting_reports.user_discussion_points, meeting_reports.discussion_points) AS discussion_points,
          meeting_reports.user_discussion_points,
          COALESCE(decision_content.decisions, meeting_reports.decisions) AS decisions,
          meeting_reports.content_version,
          meeting_reports.content_edited_by_user_id,
          meeting_reports.content_edited_at,
          meeting_reports.action_item_candidates,
          meeting_reports.retry_count,
          meeting_reports.created_at,
          meeting_reports.updated_at,
          extraction.status AS action_item_extraction_status,
          extraction.failure_code AS action_item_extraction_failure_code,
          (
            EXISTS (
              SELECT 1
              FROM workspace_members
              WHERE workspace_members.workspace_id = meetings.workspace_id
                AND workspace_members.user_id = $2
                AND workspace_members.role = 'owner'
            )
            OR EXISTS (
              SELECT 1
              FROM meeting_participants
              WHERE meeting_participants.meeting_id = meeting_reports.meeting_id
                AND meeting_participants.user_id = $2
            )
          ) AS can_delete,
          (
            EXISTS (
              SELECT 1
              FROM workspace_members
              WHERE workspace_members.workspace_id = meetings.workspace_id
                AND workspace_members.user_id = $2
                AND workspace_members.role = 'owner'
            )
            OR EXISTS (
              SELECT 1
              FROM meeting_participants
              WHERE meeting_participants.meeting_id = meeting_reports.meeting_id
                AND meeting_participants.user_id = $2
            )
          ) AS can_edit,
          ${this.meetingReportParticipantSummaryColumns()}
        FROM meeting_reports
        JOIN meetings
          ON meetings.id = meeting_reports.meeting_id
        LEFT JOIN meeting_report_action_item_extractions AS extraction
          ON extraction.meeting_report_id = meeting_reports.id
        LEFT JOIN LATERAL (
          SELECT string_agg(COALESCE(user_text, text), E'\n' ORDER BY source_index) AS decisions
          FROM meeting_report_decision_items
          WHERE meeting_report_id = meeting_reports.id
        ) AS decision_content ON true
        ${this.meetingReportParticipantSummaryJoin("meeting_reports")}
        WHERE meetings.workspace_id = $1
          AND meeting_reports.id = $3
        LIMIT 1
      `,
      [workspaceId, currentUserId, reportId]
    );
  }

  private async countParticipants(
    meetingId: string
  ): Promise<{ participantCount: number; activeParticipantCount: number }> {
    const result = await this.database.queryOne<ParticipantCountRow>(
      `
        SELECT
          COUNT(DISTINCT user_id)::int AS participant_count,
          (COUNT(DISTINCT user_id) FILTER (WHERE left_at IS NULL))::int
            AS active_participant_count
        FROM meeting_participants
        WHERE meeting_id = $1
      `,
      [meetingId]
    );

    return {
      participantCount: Number(result?.participant_count ?? 0),
      activeParticipantCount: Number(result?.active_participant_count ?? 0)
    };
  }

  private async listParticipantRows(meetingId: string): Promise<ParticipantRow[]> {
    return this.database.query<ParticipantRow>(
      `
        WITH participant_summaries AS (
          SELECT
            meeting_id,
            user_id,
            MIN(joined_at) AS joined_at,
            CASE
              WHEN BOOL_OR(left_at IS NULL) THEN NULL
              ELSE MAX(left_at)
            END AS left_at,
            (
              ARRAY_AGG(
                id
                ORDER BY (left_at IS NULL) DESC, joined_at DESC, id DESC
              )
            )[1] AS id,
            (
              ARRAY_AGG(
                livekit_identity
                ORDER BY (left_at IS NULL) DESC, joined_at DESC, id DESC
              )
            )[1] AS livekit_identity
          FROM meeting_participants
          WHERE meeting_id = $1
          GROUP BY meeting_id, user_id
        )
        SELECT
          participant_summaries.id,
          participant_summaries.meeting_id,
          participant_summaries.user_id,
          participant_summaries.livekit_identity,
          participant_summaries.joined_at,
          participant_summaries.left_at,
          users.name AS user_name,
          users.avatar_url AS user_avatar_url
        FROM participant_summaries
        JOIN users ON users.id = participant_summaries.user_id
        ORDER BY participant_summaries.joined_at ASC, participant_summaries.id ASC
      `,
      [meetingId]
    );
  }

  private async upsertParticipant(
    executor: QueryOneExecutor,
    meetingId: string,
    currentUserId: string
  ): Promise<ParticipantRow> {
    const participant = await executor.queryOne<ParticipantRow>(
      `
        WITH participant_lock AS (
          SELECT pg_advisory_xact_lock(
            hashtextextended(
              ($1::uuid)::text || ':' || ($2::uuid)::text,
              0
            )
          )
        ),
        active_participant AS (
          SELECT meeting_participants.*
          FROM meeting_participants
          CROSS JOIN participant_lock
          WHERE meeting_id = $1::uuid
            AND user_id = $2::uuid
            AND left_at IS NULL
          FOR UPDATE
        ),
        inserted_participant AS (
          INSERT INTO meeting_participants (
            meeting_id,
            user_id,
            livekit_identity
          )
          SELECT meeting_id, user_id, livekit_identity
          FROM (
            SELECT
              $1::uuid AS meeting_id,
              $2::uuid AS user_id,
              'meeting-' || ($1::uuid)::text || '-user-' || ($2::uuid)::text
                AS livekit_identity
          ) AS candidate
          WHERE NOT EXISTS (SELECT 1 FROM active_participant)
          ON CONFLICT DO NOTHING
          RETURNING *
        ),
        resolved_participant AS (
          SELECT * FROM active_participant
          UNION ALL
          SELECT * FROM inserted_participant
        )
        SELECT
          resolved_participant.id,
          resolved_participant.meeting_id,
          resolved_participant.user_id,
          resolved_participant.livekit_identity,
          resolved_participant.joined_at,
          resolved_participant.left_at,
          users.name AS user_name,
          users.avatar_url AS user_avatar_url
        FROM resolved_participant
        JOIN users
          ON users.id = resolved_participant.user_id
      `,
      [meetingId, currentUserId]
    );

    if (participant) {
      return participant;
    }

    // Before 072, the former global unique constraint rejects the insert above.
    // This transaction already holds the participant advisory lock, so only that
    // old-schema compatibility path can reactivate one latest closed row. After
    // 072 the insert succeeds for a new session and this path is not used.
    const reactivatedParticipant = await executor.queryOne<ParticipantRow>(
      `
        WITH active_participant AS (
          SELECT *
          FROM meeting_participants
          WHERE meeting_id = $1::uuid
            AND user_id = $2::uuid
            AND left_at IS NULL
          FOR UPDATE
        ),
        legacy_participant AS (
          SELECT id
          FROM meeting_participants
          WHERE meeting_id = $1::uuid
            AND user_id = $2::uuid
            AND left_at IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM active_participant)
          ORDER BY joined_at DESC, id DESC
          LIMIT 1
          FOR UPDATE
        ),
        reactivated_participant AS (
          UPDATE meeting_participants
          SET
            joined_at = now(),
            left_at = NULL,
            livekit_identity =
              'meeting-' || ($1::uuid)::text || '-user-' || ($2::uuid)::text,
            updated_at = now()
          WHERE id = (SELECT id FROM legacy_participant)
          RETURNING *
        ),
        resolved_participant AS (
          SELECT * FROM active_participant
          UNION ALL
          SELECT * FROM reactivated_participant
        )
        SELECT
          resolved_participant.id,
          resolved_participant.meeting_id,
          resolved_participant.user_id,
          resolved_participant.livekit_identity,
          resolved_participant.joined_at,
          resolved_participant.left_at,
          users.name AS user_name,
          users.avatar_url AS user_avatar_url
        FROM resolved_participant
        JOIN users ON users.id = resolved_participant.user_id
      `,
      [meetingId, currentUserId]
    );

    if (!reactivatedParticipant) {
      throw badRequest("Meeting participant could not be saved");
    }

    return reactivatedParticipant;
  }

  private async findParticipantSummary(
    executor: QueryOneExecutor,
    meetingId: string,
    currentUserId: string
  ): Promise<ParticipantRow | null> {
    return executor.queryOne<ParticipantRow>(
      `
        WITH participant_summary AS (
          SELECT
            meeting_id,
            user_id,
            MIN(joined_at) AS joined_at,
            CASE
              WHEN BOOL_OR(left_at IS NULL) THEN NULL
              ELSE MAX(left_at)
            END AS left_at,
            (
              ARRAY_AGG(
                id
                ORDER BY (left_at IS NULL) DESC, joined_at DESC, id DESC
              )
            )[1] AS id,
            (
              ARRAY_AGG(
                livekit_identity
                ORDER BY (left_at IS NULL) DESC, joined_at DESC, id DESC
              )
            )[1] AS livekit_identity
          FROM meeting_participants
          WHERE meeting_id = $1
            AND user_id = $2
          GROUP BY meeting_id, user_id
        )
        SELECT
          participant_summary.id,
          participant_summary.meeting_id,
          participant_summary.user_id,
          participant_summary.livekit_identity,
          participant_summary.joined_at,
          participant_summary.left_at,
          users.name AS user_name,
          users.avatar_url AS user_avatar_url
        FROM participant_summary
        JOIN users ON users.id = participant_summary.user_id
        LIMIT 1
      `,
      [meetingId, currentUserId]
    );
  }

  private async findActiveParticipant(
    executor: QueryOneExecutor,
    meetingId: string,
    currentUserId: string
  ): Promise<ParticipantRow | null> {
    return executor.queryOne<ParticipantRow>(
      `
        SELECT
          meeting_participants.id,
          meeting_participants.meeting_id,
          meeting_participants.user_id,
          meeting_participants.livekit_identity,
          meeting_participants.joined_at,
          meeting_participants.left_at,
          users.name AS user_name,
          users.avatar_url AS user_avatar_url
        FROM meeting_participants
        JOIN users ON users.id = meeting_participants.user_id
        WHERE meeting_participants.meeting_id = $1
          AND meeting_participants.user_id = $2
          AND meeting_participants.left_at IS NULL
        LIMIT 1
      `,
      [meetingId, currentUserId]
    );
  }

  private async findParticipantByLiveKitIdentity(
    executor: QueryOneExecutor,
    meetingId: string,
    liveKitIdentity: string,
    options: { lockParticipant?: boolean } = {}
  ): Promise<ParticipantRow | null> {
    return executor.queryOne<ParticipantRow>(
      `
        SELECT
          meeting_participants.id,
          meeting_participants.meeting_id,
          meeting_participants.user_id,
          meeting_participants.livekit_identity,
          meeting_participants.joined_at,
          meeting_participants.left_at,
          users.name AS user_name,
          users.avatar_url AS user_avatar_url
        FROM meeting_participants
        JOIN users
          ON users.id = meeting_participants.user_id
        WHERE meeting_participants.meeting_id = $1
          AND meeting_participants.livekit_identity = $2
          AND meeting_participants.left_at IS NULL
        LIMIT 1
        ${options.lockParticipant === true ? "FOR UPDATE OF meeting_participants" : ""}
      `,
      [meetingId, liveKitIdentity]
    );
  }

  private async assertActiveParticipant(
    executor: QueryOneExecutor,
    meetingId: string,
    currentUserId: string
  ): Promise<void> {
    const participant = await this.findActiveParticipant(
      executor,
      meetingId,
      currentUserId
    );

    if (!participant || participant.left_at !== null) {
      throw forbidden("Current user is not an active meeting participant");
    }
  }

  private async ensureWorkspaceRecordingConsent(
    executor: QueryOneExecutor,
    workspaceId: string,
    currentUserId: string,
    recordingConsent: RecordingConsentDraft | null
  ): Promise<void> {
    const existingConsent = await executor.queryOne<WorkspaceRecordingConsentRow>(
      `
        SELECT workspace_id, user_id, policy_version, accepted_at
        FROM workspace_recording_consents
        WHERE workspace_id = $1::uuid
          AND user_id = $2::uuid
          AND policy_version = $3
        LIMIT 1
      `,
      [workspaceId, currentUserId, WORKSPACE_RECORDING_CONSENT_POLICY_VERSION]
    );

    if (existingConsent) {
      return;
    }

    if (recordingConsent === null) {
      throw workspaceRecordingConsentRequired();
    }

    const insertedConsent = await executor.queryOne<WorkspaceRecordingConsentRow>(
      `
        INSERT INTO workspace_recording_consents (
          workspace_id,
          user_id,
          policy_version
        )
        VALUES ($1::uuid, $2::uuid, $3)
        ON CONFLICT (workspace_id, user_id, policy_version) DO NOTHING
        RETURNING workspace_id, user_id, policy_version, accepted_at
      `,
      [workspaceId, currentUserId, recordingConsent.policyVersion]
    );

    if (insertedConsent) {
      return;
    }

    const concurrentConsent = await executor.queryOne<WorkspaceRecordingConsentRow>(
      `
        SELECT workspace_id, user_id, policy_version, accepted_at
        FROM workspace_recording_consents
        WHERE workspace_id = $1::uuid
          AND user_id = $2::uuid
          AND policy_version = $3
        LIMIT 1
      `,
      [workspaceId, currentUserId, WORKSPACE_RECORDING_CONSENT_POLICY_VERSION]
    );

    if (!concurrentConsent) {
      throw workspaceRecordingConsentRequired();
    }
  }

  private async assertAllActiveParticipantsHaveRecordingConsent(
    executor: QueryOneExecutor,
    workspaceId: string,
    meetingId: string
  ): Promise<void> {
    const participantWithoutConsent =
      await executor.queryOne<MissingWorkspaceRecordingConsentRow>(
        `
          SELECT meeting_participants.user_id
          FROM meeting_participants
          WHERE meeting_participants.meeting_id = $1::uuid
            AND meeting_participants.left_at IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM workspace_recording_consents
              WHERE workspace_recording_consents.workspace_id = $2::uuid
                AND workspace_recording_consents.user_id = meeting_participants.user_id
                AND workspace_recording_consents.policy_version = $3
            )
          LIMIT 1
        `,
        [meetingId, workspaceId, WORKSPACE_RECORDING_CONSENT_POLICY_VERSION]
      );

    if (participantWithoutConsent) {
      throw workspaceRecordingConsentRequired();
    }
  }

  private async markParticipantLeft(
    executor: QueryOneExecutor,
    participantId: string
  ): Promise<ParticipantRow> {
    const participant = await executor.queryOne<ParticipantRow>(
      `
        WITH updated_participant AS (
          UPDATE meeting_participants
          SET
            left_at = now(),
            updated_at = now()
          WHERE id = $1
            AND left_at IS NULL
          RETURNING *
        )
        SELECT
          updated_participant.id,
          updated_participant.meeting_id,
          updated_participant.user_id,
          updated_participant.livekit_identity,
          updated_participant.joined_at,
          updated_participant.left_at,
          users.name AS user_name,
          users.avatar_url AS user_avatar_url
        FROM updated_participant
        JOIN users
          ON users.id = updated_participant.user_id
      `,
      [participantId]
    );

    if (!participant) {
      throw notFound("Participant not found");
    }

    return participant;
  }

  private async countActiveParticipants(
    executor: QueryOneExecutor,
    meetingId: string
  ): Promise<number> {
    const result = await executor.queryOne<ActiveParticipantCountRow>(
      `
        SELECT COUNT(*)::int AS active_participant_count
        FROM meeting_participants
        WHERE meeting_id = $1
          AND left_at IS NULL
      `,
      [meetingId]
    );

    return Number(result?.active_participant_count ?? 0);
  }

  private async endMeetingIfStillActive(
    executor: QueryOneExecutor,
    workspaceId: string,
    meetingId: string
  ): Promise<MeetingRow | null> {
    return executor.queryOne<MeetingRow>(
      `
        UPDATE meetings
        SET
          ended_at = now(),
          updated_at = now()
        WHERE workspace_id = $1
          AND id = $2
          AND ended_at IS NULL
        RETURNING *
      `,
      [workspaceId, meetingId]
    );
  }

  private async stopRunningRecording(
    executor: DatabaseTransaction,
    meeting: CurrentMeetingRow,
    recording = this.toCurrentRecordingRow(meeting)
  ): Promise<RecordingRow> {
    if (recording === null) {
      throw badRequest("No running recording found");
    }

    if (recording.livekit_egress_id === null) {
      return this.updateRecordingFailed(
        executor,
        recording,
        SAFE_EGRESS_STOP_ERROR
      );
    }

    try {
      const result = await this.liveKitEgressService.stopEgress(
        recording.livekit_egress_id
      );

      if (result.status === "FAILED") {
        return this.updateRecordingFailed(
          executor,
          recording,
          result.errorMessage ?? SAFE_EGRESS_STOP_ERROR
        );
      }

      return this.updateRecordingCompleted(executor, recording, result);
    } catch {
      return this.updateRecordingFailed(
        executor,
        recording,
        SAFE_EGRESS_STOP_ERROR
      );
    }
  }

  private async stopStartedEgressAfterPersistenceFailure(
    livekitEgressId: string
  ): Promise<void> {
    try {
      await this.liveKitEgressService.stopEgress(livekitEgressId);
    } catch {
      // Best effort cleanup: the original persistence error remains the API result.
    }
  }

  private async markRecordingFailedAfterPersistenceFailure(
    recording: RecordingRow
  ): Promise<RecordingRow | null> {
    try {
      return await this.database.transaction((transaction) =>
        this.updateRecordingFailed(
          transaction,
          recording,
          SAFE_EGRESS_START_ERROR
        )
      );
    } catch {
      // Best effort cleanup: the original persistence error remains the API result.
      return null;
    }
  }

  private buildAudioFileKey(
    workspaceId: string,
    meetingId: string,
    recordingId: string
  ): string {
    const prefix = (process.env.LIVEKIT_EGRESS_S3_PREFIX ?? "recordings/meetings")
      .trim()
      .replace(/^\/+|\/+$/g, "");

    return [
      prefix,
      `workspaces/${workspaceId}`,
      `meetings/${meetingId}`,
      `recordings/${recordingId}.mp3`
    ]
      .filter(Boolean)
      .join("/");
  }

  private normalizeStartMeetingBody(body: unknown): {
    roomKey: string;
    recordingConsent: RecordingConsentDraft | null;
  } {
    if (body === undefined || body === null) {
      return { roomKey: MAIN_MEETING_ROOM, recordingConsent: null };
    }

    if (typeof body !== "object" || Array.isArray(body)) {
      throw badRequest("Request body must be an object");
    }

    const draft = body as StartMeetingDraft;
    const recordingConsent = this.normalizeRecordingConsent(
      draft.recordingConsent
    );
    if (draft.roomKey === undefined || draft.roomKey === null) {
      return { roomKey: MAIN_MEETING_ROOM, recordingConsent };
    }

    if (typeof draft.roomKey !== "string") {
      throw badRequest("roomKey must be a string");
    }

    const roomKey = draft.roomKey.trim();
    if (roomKey !== MAIN_MEETING_ROOM) {
      throw badRequest("roomKey must be MAIN_MEETING_ROOM");
    }

    return { roomKey, recordingConsent };
  }

  private normalizeRecordingConsent(
    value: unknown
  ): RecordingConsentDraft | null {
    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value !== "object" || Array.isArray(value)) {
      throw badRequest("recordingConsent must be an object");
    }

    const draft = value as { accepted?: unknown; policyVersion?: unknown };
    if (draft.accepted !== true) {
      throw badRequest("recordingConsent.accepted must be true");
    }
    if (draft.policyVersion !== WORKSPACE_RECORDING_CONSENT_POLICY_VERSION) {
      throw badRequest(
        `recordingConsent.policyVersion must be ${WORKSPACE_RECORDING_CONSENT_POLICY_VERSION}`
      );
    }

    return {
      accepted: true,
      policyVersion: WORKSPACE_RECORDING_CONSENT_POLICY_VERSION
    };
  }

  private normalizeMeetingRoomName(body: unknown): string {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw badRequest("Request body must be an object");
    }

    const draft = body as MeetingRoomNameDraft;
    if (typeof draft.name !== "string") {
      throw badRequest("name must be a string");
    }

    const name = draft.name.trim().replace(/\s+/g, " ");
    if (!name) {
      throw badRequest("name is required");
    }
    if (name.length > MEETING_ROOM_NAME_MAX_LENGTH) {
      throw badRequest(
        `name must be at most ${MEETING_ROOM_NAME_MAX_LENGTH} characters`
      );
    }
    if (name === DEFAULT_MEETING_ROOM_NAME) {
      throw badRequest("Default meeting room name is reserved");
    }

    return name;
  }

  private mapMeetingRoom(
    room: MeetingRoomRow,
    isDefault = room.room_key === MAIN_MEETING_ROOM
  ): MeetingRoomPayload {
    return {
      id: room.id,
      workspaceId: room.workspace_id,
      roomKey: room.room_key,
      name: room.name,
      isDefault,
      createdById: room.created_by_id,
      createdAt: this.toIsoString(room.created_at),
      updatedAt: this.toIsoString(room.updated_at)
    };
  }

  private mapMeeting(meeting: MeetingRow): MeetingPayload {
    return {
      id: meeting.id,
      workspaceId: meeting.workspace_id,
      roomKey: meeting.room_key,
      livekitRoomName: meeting.livekit_room_name,
      createdById: meeting.created_by_id,
      endedById: meeting.ended_by_id,
      startedAt: this.toIsoString(meeting.started_at),
      endedAt: this.toNullableIsoString(meeting.ended_at),
      createdAt: this.toIsoString(meeting.created_at),
      updatedAt: this.toIsoString(meeting.updated_at)
    };
  }

  private mapNullableCurrentRecording(row: CurrentMeetingRow): RecordingPayload | null {
    const recording = this.toCurrentRecordingRow(row);
    if (recording === null) {
      return null;
    }

    return this.mapRecording(recording);
  }

  private toCurrentRecordingRow(row: CurrentMeetingRow): RecordingRow | null {
    if (row.recording_id === null || row.recording_meeting_id === null) {
      return null;
    }

    if (row.recording_started_at === null || row.recording_status === null) {
      return null;
    }

    return {
      id: row.recording_id,
      meeting_id: row.recording_meeting_id,
      livekit_egress_id: row.recording_livekit_egress_id,
      status: row.recording_status,
      audio_file_url: row.recording_audio_file_url,
      audio_file_key: row.recording_audio_file_key,
      duration_sec: row.recording_duration_sec,
      file_size_bytes: row.recording_file_size_bytes,
      started_at: row.recording_started_at,
      ended_at: row.recording_ended_at,
      error_message: row.recording_error_message
    };
  }

  private mapRecording(recording: RecordingRow): RecordingPayload {
    return {
      id: recording.id,
      meetingId: recording.meeting_id,
      status: recording.status,
      audioFileUrl: recording.audio_file_url,
      audioFileKey: recording.audio_file_key,
      durationSec: recording.duration_sec,
      fileSizeBytes:
        recording.file_size_bytes === null
          ? null
          : Number(recording.file_size_bytes),
      startedAt: this.toIsoString(recording.started_at),
      endedAt: this.toNullableIsoString(recording.ended_at),
      errorMessage: recording.error_message
    };
  }

  private mapStartMeeting(
    row: StartMeetingRow,
    livekit: LiveKitJoinPayload
  ): StartMeetingPayload {
    return {
      meeting: {
        id: row.meeting_id,
        workspaceId: row.meeting_workspace_id,
        roomKey: row.meeting_room_key,
        livekitRoomName: row.meeting_livekit_room_name,
        createdById: row.meeting_created_by_id,
        endedById: row.meeting_ended_by_id,
        startedAt: this.toIsoString(row.meeting_started_at),
        endedAt: this.toNullableIsoString(row.meeting_ended_at),
        createdAt: this.toIsoString(row.meeting_created_at),
        updatedAt: this.toIsoString(row.meeting_updated_at)
      },
      participant: {
        id: row.participant_id,
        meetingId: row.participant_meeting_id,
        userId: row.participant_user_id,
        livekitIdentity: row.participant_livekit_identity,
        joinedAt: this.toIsoString(row.participant_joined_at),
        leftAt: this.toNullableIsoString(row.participant_left_at),
        isActive: row.participant_left_at === null,
        user: {
          id: row.participant_user_id,
          name: row.participant_user_name,
          avatarUrl: row.participant_user_avatar_url
        }
      },
      livekit,
      currentRecording: null
    };
  }

  private mapParticipant(participant: ParticipantRow): ParticipantPayload {
    return {
      id: participant.id,
      meetingId: participant.meeting_id,
      userId: participant.user_id,
      livekitIdentity: participant.livekit_identity,
      joinedAt: this.toIsoString(participant.joined_at),
      leftAt: this.toNullableIsoString(participant.left_at),
      isActive: participant.left_at === null,
      user: {
        id: participant.user_id,
        name: participant.user_name,
        avatarUrl: participant.user_avatar_url
      }
    };
  }

  private mapMeetingReportSummary(
    report: MeetingReportRow
  ): MeetingReportSummaryPayload {
    const actionItemExtraction = this.mapActionItemExtraction(report);
    return {
      id: report.id,
      meetingId: report.meeting_id,
      recordingId: report.recording_id,
      status: report.status,
      failedStep: report.failed_step,
      errorMessage: report.error_message,
      title: report.title,
      summary: report.summary,
      discussionPoints: report.discussion_points,
      decisions: report.decisions,
      contentVersion: Number(report.content_version),
      contentEditedByUserId: report.content_edited_by_user_id,
      contentEditedAt: this.toNullableIsoString(report.content_edited_at),
      actionItemCandidates: this.toJsonArray(report.action_item_candidates),
      ...(actionItemExtraction
        ? { actionItemExtraction }
        : {}),
      retryCount: Number(report.retry_count),
      participantSummary: this.mapMeetingReportParticipantSummary(report),
      ...(typeof report.can_delete === "boolean"
        ? { canDelete: report.can_delete }
        : {}),
      ...(typeof report.can_edit === "boolean"
        ? { canEdit: report.can_edit }
        : {}),
      createdAt: this.toIsoString(report.created_at),
      updatedAt: this.toIsoString(report.updated_at)
    };
  }

  private mapActionItemExtraction(
    report: MeetingReportRow
  ): MeetingReportActionItemExtractionPayload | null {
    const rawStatus = report.action_item_extraction_status;
    if (typeof rawStatus !== "string") return null;
    const status = rawStatus.toUpperCase() as MeetingReportActionItemExtractionStatus;
    if (![
      "PENDING", "PUBLISHING", "QUEUED", "PROCESSING", "COMPLETED", "FAILED"
    ].includes(status)) return null;
    return {
      status,
      errorMessage: status === "FAILED" ? "후속 작업을 생성하지 못했습니다." : null
    };
  }

  private mapMeetingReportParticipantSummary(report: MeetingReportRow) {
    const participants = this.toJsonArray(report.participant_preview).flatMap((value) => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
      const participant = value as Record<string, unknown>;
      if (typeof participant.userId !== "string") return [];
      return [{
        userId: participant.userId,
        name: typeof participant.name === "string" ? participant.name : null,
        avatarUrl: typeof participant.avatarUrl === "string" ? participant.avatarUrl : null
      }];
    });
    const totalCount = Number(report.participant_count ?? 0);
    return { totalCount, participants, hasMore: totalCount > participants.length };
  }

  private meetingReportParticipantSummaryColumns(): string {
    return "COALESCE(participant_summary.participant_count, 0)::int AS participant_count, COALESCE(participant_summary.participant_preview, '[]'::jsonb) AS participant_preview";
  }

  private meetingReportParticipantSummaryJoin(reportAlias: string): string {
    return `LEFT JOIN LATERAL (
      SELECT
        (SELECT COUNT(DISTINCT user_id)::int FROM meeting_participants WHERE meeting_id = ${reportAlias}.meeting_id) AS participant_count,
        (SELECT COALESCE(jsonb_agg(jsonb_build_object('userId', preview.user_id, 'name', preview.name, 'avatarUrl', preview.avatar_url) ORDER BY preview.joined_at ASC, preview.id ASC), '[]'::jsonb)
         FROM (
           SELECT first_session.id, first_session.user_id, first_session.joined_at, first_session.name, first_session.avatar_url
           FROM (
             SELECT DISTINCT ON (meeting_participants.user_id)
               meeting_participants.id,
               meeting_participants.user_id,
               meeting_participants.joined_at,
               users.name,
               users.avatar_url
             FROM meeting_participants
             JOIN users ON users.id = meeting_participants.user_id
             WHERE meeting_participants.meeting_id = ${reportAlias}.meeting_id
             ORDER BY meeting_participants.user_id, meeting_participants.joined_at ASC, meeting_participants.id ASC
           ) AS first_session
           ORDER BY first_session.joined_at ASC, first_session.id ASC
           LIMIT 3
         ) AS preview) AS participant_preview
    ) AS participant_summary ON true`;
  }

  private async transitionMeetingReportActionItem(
    currentUserId: string,
    workspaceId: string,
    reportId: string,
    actionItemId: string,
    status: "APPROVED" | "DISMISSED"
  ): Promise<MeetingReportActionItemRow> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);

    return this.database.transaction(async (transaction) => {
      const current = await this.findMeetingReportActionItemForUpdate(
        transaction,
        workspaceId,
        reportId,
        actionItemId
      );
      this.assertPendingMeetingReportActionItem(current);
      const updated = await transaction.queryOne<{ id: string }>(
        status === "APPROVED"
          ? `UPDATE meeting_report_action_items
             SET status = 'APPROVED', updated_by_user_id = $2,
                 approved_by_user_id = $2, approved_at = now(), updated_at = now()
             WHERE id = $1 AND status = 'PENDING'
             RETURNING id`
          : `UPDATE meeting_report_action_items
             SET status = 'DISMISSED', updated_by_user_id = $2,
                 dismissed_by_user_id = $2, dismissed_at = now(), updated_at = now()
             WHERE id = $1 AND status = 'PENDING'
             RETURNING id`,
        [current.id, currentUserId]
      );
      if (updated === null) throw badRequest("Action item is no longer pending");
      return this.findMeetingReportActionItemForUpdate(
        transaction,
        workspaceId,
        reportId,
        actionItemId
      );
    });
  }

  private async findMeetingReportActionItemForUpdate(
    executor: QueryOneExecutor,
    workspaceId: string,
    reportId: string,
    actionItemId: string
  ): Promise<MeetingReportActionItemRow> {
    if (!UUID_PATTERN.test(reportId) || !UUID_PATTERN.test(actionItemId)) {
      throw notFound("Meeting report action item not found");
    }
    const actionItem = await executor.queryOne<MeetingReportActionItemRow>(
      `SELECT action_items.id, action_items.meeting_report_id, action_items.source_index,
              action_items.title, action_items.description, action_items.priority,
              action_items.assignee_user_id, users.name AS assignee_name,
              users.avatar_url AS assignee_avatar_url,
              meeting_reports.action_item_candidates,
              action_items.status,
              action_items.updated_by_user_id, action_items.approved_by_user_id,
              action_items.approved_at, action_items.dismissed_by_user_id,
              action_items.dismissed_at, action_items.created_at, action_items.updated_at
       FROM meeting_report_action_items AS action_items
       JOIN meeting_reports ON meeting_reports.id = action_items.meeting_report_id
       JOIN meetings ON meetings.id = meeting_reports.meeting_id
       LEFT JOIN users ON users.id = action_items.assignee_user_id
       WHERE meetings.workspace_id = $1
         AND action_items.meeting_report_id = $2
         AND action_items.id = $3
       FOR UPDATE OF action_items`,
      [workspaceId, reportId, actionItemId]
    );
    if (actionItem === null) throw notFound("Meeting report action item not found");
    return actionItem;
  }

  private assertPendingMeetingReportActionItem(
    actionItem: MeetingReportActionItemRow
  ): void {
    if (actionItem.status !== "PENDING") {
      throw badRequest("Action item is no longer pending");
    }
  }

  private async assertWorkspaceMember(
    executor: QueryOneExecutor,
    workspaceId: string,
    userId: string
  ): Promise<void> {
    const member = await executor.queryOne<{ user_id: string }>(
      `SELECT user_id FROM workspace_members
       WHERE workspace_id = $1 AND user_id = $2`,
      [workspaceId, userId]
    );
    if (member === null) {
      throw badRequest("Action item assignee must be a Workspace member");
    }
  }

  private async updatePendingMeetingReportActionItem(
    executor: QueryOneExecutor,
    actionItem: MeetingReportActionItemRow,
    values: {
      title: string;
      description: string;
      priority: "LOW" | "MEDIUM" | "HIGH";
      assigneeUserId: string | null;
    },
    currentUserId: string
  ): Promise<MeetingReportActionItemRow> {
    const updated = await executor.queryOne<{ id: string }>(
      `UPDATE meeting_report_action_items
       SET title = $2, description = $3, priority = $4, assignee_user_id = $5,
           updated_by_user_id = $6, updated_at = now()
       WHERE id = $1 AND status = 'PENDING'
       RETURNING id`,
      [
        actionItem.id,
        values.title,
        values.description,
        values.priority,
        values.assigneeUserId,
        currentUserId
      ]
    );
    if (updated === null) throw badRequest("Action item is no longer pending");
    return {
      ...actionItem,
      assignee_avatar_url: values.assigneeUserId === actionItem.assignee_user_id
        ? actionItem.assignee_avatar_url
        : null,
      assignee_name: values.assigneeUserId === actionItem.assignee_user_id
        ? actionItem.assignee_name
        : null,
      assignee_user_id: values.assigneeUserId,
      description: values.description,
      priority: values.priority,
      title: values.title,
      updated_at: new Date(),
      updated_by_user_id: currentUserId
    };
  }

  private normalizeMeetingReportActionItemPatch(body: unknown): {
    title?: string;
    description?: string;
    priority?: "LOW" | "MEDIUM" | "HIGH";
    assigneeUserId?: string | null;
  } {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw badRequest("Action item patch must be an object");
    }
    const patch = body as Record<string, unknown>;
    const allowed = new Set(["title", "description", "priority", "assigneeUserId"]);
    if (!Object.keys(patch).length || Object.keys(patch).some((key) => !allowed.has(key))) {
      throw badRequest("Invalid action item patch");
    }
    const normalized: {
      title?: string;
      description?: string;
      priority?: "LOW" | "MEDIUM" | "HIGH";
      assigneeUserId?: string | null;
    } = {};
    if (Object.hasOwn(patch, "title")) normalized.title = this.normalizeActionItemText(patch.title, "title", 500);
    if (Object.hasOwn(patch, "description")) normalized.description = this.normalizeActionItemText(patch.description, "description", 5000);
    if (Object.hasOwn(patch, "priority")) {
      if (patch.priority !== "LOW" && patch.priority !== "MEDIUM" && patch.priority !== "HIGH") {
        throw badRequest("Invalid action item priority");
      }
      normalized.priority = patch.priority;
    }
    if (Object.hasOwn(patch, "assigneeUserId")) {
      if (patch.assigneeUserId === null) normalized.assigneeUserId = null;
      else if (typeof patch.assigneeUserId === "string" && UUID_PATTERN.test(patch.assigneeUserId)) normalized.assigneeUserId = patch.assigneeUserId;
      else throw badRequest("Invalid action item assignee");
    }
    return normalized;
  }

  private normalizeMeetingReportContentPatch(body: unknown): {
    expectedVersion: number;
    title?: string;
    discussionPoints?: string;
    decisionItems: Array<{ id: string; text: string }>;
  } {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw badRequest("Meeting report patch must be an object");
    }
    const patch = body as Record<string, unknown>;
    const allowed = new Set([
      "expectedVersion",
      "title",
      "discussionPoints",
      "decisionItems"
    ]);
    if (
      Object.keys(patch).some((key) => !allowed.has(key)) ||
      !Object.hasOwn(patch, "expectedVersion")
    ) {
      throw badRequest("Invalid meeting report patch");
    }
    if (
      typeof patch.expectedVersion !== "number" ||
      !Number.isInteger(patch.expectedVersion) ||
      patch.expectedVersion < 1
    ) {
      throw badRequest("Invalid meeting report expectedVersion");
    }

    const normalized: {
      expectedVersion: number;
      title?: string;
      discussionPoints?: string;
      decisionItems: Array<{ id: string; text: string }>;
    } = {
      expectedVersion: patch.expectedVersion,
      decisionItems: []
    };
    if (Object.hasOwn(patch, "title")) {
      normalized.title = this.normalizeMeetingReportContentText(
        patch.title,
        "title",
        500
      );
    }
    if (Object.hasOwn(patch, "discussionPoints")) {
      normalized.discussionPoints = this.normalizeMeetingReportContentText(
        patch.discussionPoints,
        "discussionPoints",
        16000
      );
    }
    if (Object.hasOwn(patch, "decisionItems")) {
      if (!Array.isArray(patch.decisionItems) || !patch.decisionItems.length) {
        throw badRequest("Meeting report decisionItems must be a non-empty array");
      }
      const seenIds = new Set<string>();
      normalized.decisionItems = patch.decisionItems.map((value) => {
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
          throw badRequest("Invalid meeting report decision item");
        }
        const item = value as Record<string, unknown>;
        if (
          Object.keys(item).length !== 2 ||
          !Object.hasOwn(item, "id") ||
          !Object.hasOwn(item, "text") ||
          typeof item.id !== "string" ||
          !UUID_PATTERN.test(item.id) ||
          seenIds.has(item.id)
        ) {
          throw badRequest("Invalid meeting report decision item");
        }
        seenIds.add(item.id);
        return {
          id: item.id,
          text: this.normalizeMeetingReportContentText(item.text, "decision text", 5000)
        };
      });
    }
    if (
      normalized.title === undefined &&
      normalized.discussionPoints === undefined &&
      !normalized.decisionItems.length
    ) {
      throw badRequest("Meeting report patch must update content");
    }
    return normalized;
  }

  private normalizeMeetingReportContentText(
    value: unknown,
    field: string,
    maxLength: number
  ): string {
    if (typeof value !== "string") {
      throw badRequest(`Meeting report ${field} must be a string`);
    }
    const normalized = value.trim();
    if (!normalized || Buffer.byteLength(normalized, "utf8") > maxLength) {
      throw badRequest(`Invalid meeting report ${field}`);
    }
    return normalized;
  }

  private normalizeActionItemText(value: unknown, field: string, maxLength: number): string {
    if (typeof value !== "string") throw badRequest(`Action item ${field} must be a string`);
    const normalized = value.trim();
    if (!normalized || Buffer.byteLength(normalized, "utf8") > maxLength) {
      throw badRequest(`Invalid action item ${field}`);
    }
    return normalized;
  }

  private mapMeetingReportActionItem(
    actionItem: MeetingReportActionItemRow
  ): MeetingReportActionItemPayload {
    return {
      id: actionItem.id,
      sourceIndex: Number(actionItem.source_index),
      title: actionItem.title,
      description: actionItem.description,
      priority: actionItem.priority,
      assignee: actionItem.assignee_user_id === null ? null : {
        userId: actionItem.assignee_user_id,
        name: actionItem.assignee_name,
        avatarUrl: actionItem.assignee_avatar_url
      },
      deliverySuggestion: this.getActionItemDeliverySuggestion(actionItem),
      status: actionItem.status,
      updatedByUserId: actionItem.updated_by_user_id,
      approvedByUserId: actionItem.approved_by_user_id,
      approvedAt: this.toNullableIsoString(actionItem.approved_at),
      dismissedByUserId: actionItem.dismissed_by_user_id,
      dismissedAt: this.toNullableIsoString(actionItem.dismissed_at),
      delivery: !actionItem.delivery_id ||
        !actionItem.delivery_type ||
        !actionItem.delivery_status
        ? null
        : {
            deliveryType: actionItem.delivery_type,
            status: actionItem.delivery_status,
            errorCode: actionItem.delivery_error_code ?? null,
            draft: this.toMeetingActionItemDeliveryDraft(
              actionItem.delivery_draft_json,
              actionItem.delivery_type
            ),
            targetResourceId: actionItem.delivery_target_resource_id ?? null,
            calendarEvent: actionItem.calendar_event_id === null ||
              actionItem.calendar_event_title === null
              ? null
              : {
                  id: String(actionItem.calendar_event_id),
                  title: actionItem.calendar_event_title ?? "일정"
                },
            piloIssue: actionItem.pilo_issue_id === null ||
              actionItem.pilo_issue_title === null ||
              actionItem.pilo_issue_board_id === null ||
              actionItem.pilo_issue_column_id === null
              ? null
              : {
                  id: String(actionItem.pilo_issue_id),
                  title: actionItem.pilo_issue_title ?? "Issue",
                  boardId: String(actionItem.pilo_issue_board_id),
                  columnId: String(actionItem.pilo_issue_column_id),
                  columnName: actionItem.pilo_issue_column_name ?? null
                }
          },
      createdAt: this.toIsoString(actionItem.created_at),
      updatedAt: this.toIsoString(actionItem.updated_at)
    };
  }

  private getActionItemDeliverySuggestion(
    actionItem: MeetingReportActionItemRow
  ): MeetingReportActionItemPayload["deliverySuggestion"] {
    const candidate = this.toJsonArray(actionItem.action_item_candidates)[
      Number(actionItem.source_index)
    ];
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      return null;
    }
    const suggestion = (candidate as Record<string, unknown>).deliverySuggestion;
    if (typeof suggestion !== "object" || suggestion === null || Array.isArray(suggestion)) {
      return null;
    }
    const value = suggestion as Record<string, unknown>;
    if (value.deliveryType === "pilo_issue") {
      return { deliveryType: "pilo_issue", calendar: null };
    }
    if (value.deliveryType !== "calendar_event") return null;
    const calendar = value.calendar;
    if (typeof calendar !== "object" || calendar === null || Array.isArray(calendar)) {
      return null;
    }
    const details = calendar as Record<string, unknown>;
    if (
      typeof details.isAllDay !== "boolean" ||
      typeof details.startDate !== "string" ||
      typeof details.endDate !== "string" ||
      (details.startTime !== null && typeof details.startTime !== "string") ||
      (details.endTime !== null && typeof details.endTime !== "string")
    ) {
      return null;
    }
    return {
      deliveryType: "calendar_event",
      calendar: {
        isAllDay: details.isAllDay,
        startDate: details.startDate,
        endDate: details.endDate,
        startTime: details.startTime,
        endTime: details.endTime
      }
    };
  }

  private mapMeetingReportDetail(report: MeetingReportDetailRow, evidence: {
    evidenceSegments: MeetingReportDetailPayload["evidenceSegments"];
    evidence: MeetingReportDetailPayload["evidence"];
    activityEvidence: MeetingReportDetailPayload["activityEvidence"];
    actionItems: MeetingReportActionItemPayload[];
    actionItemAssignees: MeetingReportActionItemAssigneePayload[];
    decisionItems: MeetingReportDecisionItemPayload[];
  }): MeetingReportDetailPayload {
    return {
      ...this.mapMeetingReportSummary(report),
      transcriptText: report.transcript_text,
      ...evidence
    };
  }

  private async listMeetingReportDecisionItems(
    reportId: string
  ): Promise<MeetingReportDecisionItemPayload[]> {
    const rows = await this.database.query<MeetingReportDecisionItemRow>(
      `SELECT id, source_index, text, user_text, edited_by_user_id, edited_at
       FROM meeting_report_decision_items
       WHERE meeting_report_id = $1
       ORDER BY source_index ASC, id ASC`,
      [reportId]
    );
    return rows.map((item) => ({
      id: item.id,
      sourceIndex: Number(item.source_index),
      text: item.user_text ?? item.text,
      isUserEdited: item.user_text !== null,
      editedByUserId: item.edited_by_user_id,
      editedAt: this.toNullableIsoString(item.edited_at)
    }));
  }

  private async listMeetingReportActionItems(
    reportId: string
  ): Promise<MeetingReportActionItemPayload[]> {
    const rows = await this.database.query<MeetingReportActionItemRow>(
      `SELECT action_items.id, action_items.meeting_report_id, action_items.source_index,
              action_items.title, action_items.description, action_items.priority,
              action_items.assignee_user_id, users.name AS assignee_name,
              users.avatar_url AS assignee_avatar_url,
              meeting_reports.action_item_candidates,
              action_items.status,
              action_items.updated_by_user_id, action_items.approved_by_user_id,
              action_items.approved_at, action_items.dismissed_by_user_id,
              action_items.dismissed_at, action_items.created_at, action_items.updated_at,
              delivery.id AS delivery_id, delivery.delivery_type, delivery.status AS delivery_status,
              delivery.last_error_code AS delivery_error_code,
              delivery.draft_json AS delivery_draft_json,
              delivery.target_resource_id AS delivery_target_resource_id,
              calendar_event.id AS calendar_event_id, calendar_event.title AS calendar_event_title,
              pilo_issue.id AS pilo_issue_id, pilo_issue.title AS pilo_issue_title,
              pilo_issue.board_id AS pilo_issue_board_id,
              pilo_issue.column_id AS pilo_issue_column_id,
              board_column.name AS pilo_issue_column_name
       FROM meeting_report_action_items AS action_items
       JOIN meeting_reports
         ON meeting_reports.id = action_items.meeting_report_id
       LEFT JOIN users ON users.id = action_items.assignee_user_id
       LEFT JOIN meeting_report_action_item_deliveries AS delivery
         ON delivery.action_item_id = action_items.id
       LEFT JOIN calendar_events AS calendar_event
         ON calendar_event.id = delivery.calendar_event_id
       LEFT JOIN pilo_issues AS pilo_issue
         ON pilo_issue.id = delivery.pilo_issue_id
       LEFT JOIN board_columns AS board_column
         ON board_column.id = pilo_issue.column_id
        AND board_column.board_id = pilo_issue.board_id
       WHERE action_items.meeting_report_id = $1
       ORDER BY action_items.source_index ASC`,
      [reportId]
    );
    return rows.map((actionItem) => this.mapMeetingReportActionItem(actionItem));
  }

  private async listMeetingReportActionItemAssignees(
    workspaceId: string
  ): Promise<MeetingReportActionItemAssigneePayload[]> {
    const rows = await this.database.query<MeetingReportActionItemAssigneeRow>(
      `SELECT workspace_members.user_id, users.name, users.avatar_url
       FROM workspace_members
       JOIN users ON users.id = workspace_members.user_id
       WHERE workspace_members.workspace_id = $1
       ORDER BY CASE workspace_members.role WHEN 'owner' THEN 0 ELSE 1 END,
                workspace_members.joined_at ASC, workspace_members.user_id ASC`,
      [workspaceId]
    );
    return rows.map((member) => ({
      userId: member.user_id,
      name: member.name,
      avatarUrl: member.avatar_url
    }));
  }

  private async listMeetingReportEvidence(reportId: string): Promise<{ evidenceSegments: MeetingReportDetailPayload["evidenceSegments"]; evidence: MeetingReportDetailPayload["evidence"] }> {
    const rows = await this.database.query<{ id: string; segment_index: number; started_at_ms: number; ended_at_ms: number; text: string; source_type: string | null; source_index: number | null; transcript_segment_id: string | null }>(`
      SELECT segments.id, segments.segment_index, segments.started_at_ms, segments.ended_at_ms, segments.text,
        evidence.source_type, evidence.source_index, evidence.transcript_segment_id
      FROM meeting_report_evidence evidence
      JOIN meeting_report_transcript_segments segments ON segments.id = evidence.transcript_segment_id
      WHERE evidence.meeting_report_id = $1
      ORDER BY segments.segment_index ASC, evidence.source_type ASC, evidence.source_index ASC
    `, [reportId]);
    const segmentMap = new Map<string, MeetingReportDetailPayload["evidenceSegments"][number]>();
    const references: MeetingReportDetailPayload["evidence"] = [];
    for (const row of rows) {
      segmentMap.set(row.id, { id: row.id, segmentIndex: Number(row.segment_index), startedAtMs: Number(row.started_at_ms), endedAtMs: Number(row.ended_at_ms), text: row.text });
      if (row.source_type !== null && row.source_index !== null && row.transcript_segment_id !== null) references.push({ sourceType: row.source_type, sourceIndex: Number(row.source_index), transcriptSegmentId: row.transcript_segment_id });
    }
    return { evidenceSegments: [...segmentMap.values()], evidence: references };
  }

  private async listMeetingReportActivityEvidence(
    reportId: string
  ): Promise<MeetingReportDetailPayload["activityEvidence"]> {
    const rows = await this.database.query<{
      id: string;
      source_index: number | string;
      occurred_at: Date | string;
      action: string;
      summary: string;
      source_type: string | null;
      reference_source_index: number | string | null;
    }>(
      `SELECT activity_evidence.id, activity_evidence.source_index, activity_evidence.occurred_at,
              activity_evidence.action::text AS action, activity_evidence.summary,
              activity_references.source_type, activity_references.source_index AS reference_source_index
       FROM meeting_report_activity_evidence AS activity_evidence
       LEFT JOIN meeting_report_activity_evidence_references AS activity_references
         ON activity_references.activity_evidence_id = activity_evidence.id
        AND activity_references.meeting_report_id = activity_evidence.meeting_report_id
       WHERE activity_evidence.meeting_report_id = $1
       ORDER BY activity_evidence.occurred_at ASC, activity_evidence.source_index ASC,
                activity_references.source_type ASC, activity_references.source_index ASC`,
      [reportId]
    );

    const activityEvidence = new Map<string, MeetingReportDetailPayload["activityEvidence"][number]>();
    for (const row of rows) {
      const item = activityEvidence.get(row.id) ?? {
        id: row.id,
        sourceIndex: Number(row.source_index),
        occurredAt: new Date(row.occurred_at).toISOString(),
        action: row.action,
        summary: row.summary,
        references: []
      };
      if (row.source_type !== null && row.reference_source_index !== null) {
        item.references.push({
          sourceType: row.source_type,
          sourceIndex: Number(row.reference_source_index)
        });
      }
      activityEvidence.set(row.id, item);
    }
    return [...activityEvidence.values()];
  }

  private normalizeMeetingReportStatus(
    status: unknown
  ): MeetingReportStatus | null {
    if (status === undefined) {
      return null;
    }

    if (typeof status !== "string") {
      throw badRequest("Invalid meeting report status");
    }

    if (MEETING_REPORT_STATUSES.includes(status as MeetingReportStatus)) {
      return status as MeetingReportStatus;
    }

    throw badRequest("Invalid meeting report status");
  }

  private normalizeMeetingReportSearchQuery(value: unknown): string | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    if (typeof value !== "string" || Array.isArray(value)) {
      throw badRequest("Invalid meeting report search query");
    }

    const query = value.trim();
    if (!query || query.length > 200) {
      throw badRequest("Invalid meeting report search query");
    }

    return query;
  }

  private normalizeMeetingReportDate(
    value: unknown,
    name: "from" | "to"
  ): string | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    if (typeof value !== "string" || Array.isArray(value)) {
      throw badRequest(`Invalid meeting report ${name}`);
    }

    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      throw badRequest(`Invalid meeting report ${name}`);
    }

    return date.toISOString();
  }

  private normalizeMeetingReportCursor(value: unknown): MeetingReportCursor | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    if (typeof value !== "string" || Array.isArray(value) || value.length > 512) {
      throw badRequest("Invalid meeting report cursor");
    }

    try {
      const parsed = JSON.parse(
        Buffer.from(value, "base64url").toString("utf8")
      ) as Partial<MeetingReportCursor>;
      const id = parsed.id;
      if (
        typeof parsed.createdAt !== "string" ||
        typeof id !== "string" ||
        !UUID_PATTERN.test(id)
      ) {
        throw new Error("Invalid cursor payload");
      }

      const createdAt = new Date(parsed.createdAt);
      if (!Number.isFinite(createdAt.getTime())) {
        throw new Error("Invalid cursor timestamp");
      }

      return { createdAt: createdAt.toISOString(), id };
    } catch {
      throw badRequest("Invalid meeting report cursor");
    }
  }

  private encodeMeetingReportCursor(cursor: MeetingReportCursor): string {
    return Buffer.from(JSON.stringify(cursor)).toString("base64url");
  }

  private isMeetingReportInProgress(status: MeetingReportStatus): boolean {
    return (
      status === "PROCESSING" ||
      status === "QUEUED" ||
      status === "TRANSCRIBING" ||
      status === "SUMMARIZING"
    );
  }

  private normalizeMeetingReportLimit(limit: unknown): number {
    if (limit === undefined || limit === null || limit === "") {
      return DEFAULT_MEETING_REPORT_LIMIT;
    }

    if (Array.isArray(limit)) {
      return DEFAULT_MEETING_REPORT_LIMIT;
    }

    const rawLimit = typeof limit === "number" ? String(limit) : limit;
    if (typeof rawLimit !== "string") {
      return DEFAULT_MEETING_REPORT_LIMIT;
    }

    const parsed = Number(rawLimit.trim());
    if (!Number.isFinite(parsed)) {
      return DEFAULT_MEETING_REPORT_LIMIT;
    }

    const integerLimit = Math.trunc(parsed);
    if (integerLimit < DEFAULT_MEETING_REPORT_LIMIT) {
      return DEFAULT_MEETING_REPORT_LIMIT;
    }

    return Math.min(integerLimit, MAX_MEETING_REPORT_LIMIT);
  }

  private toJsonArray(value: unknown): unknown[] {
    if (Array.isArray(value)) {
      return value;
    }

    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value) as unknown;
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }

    return [];
  }

  private toMeetingActionItemDeliveryDraft(
    value: unknown,
    deliveryType: "calendar_event" | "pilo_issue"
  ): MeetingActionItemDeliveryInput | null {
    const draft = this.toJsonObject(value);
    if (!draft || draft.deliveryType !== deliveryType) return null;
    if (deliveryType === "calendar_event") {
      const calendar = this.toJsonObject(draft.calendar);
      if (
        !calendar ||
        typeof calendar.startDate !== "string" ||
        typeof calendar.endDate !== "string"
      ) {
        return null;
      }
      return {
        deliveryType,
        calendar: {
          title: typeof calendar.title === "string" ? calendar.title : undefined,
          description:
            typeof calendar.description === "string" || calendar.description === null
              ? calendar.description
              : undefined,
          color: typeof calendar.color === "string" ? calendar.color : undefined,
          isAllDay: typeof calendar.isAllDay === "boolean" ? calendar.isAllDay : undefined,
          startDate: calendar.startDate,
          endDate: calendar.endDate,
          startTime:
            typeof calendar.startTime === "string" || calendar.startTime === null
              ? calendar.startTime
              : undefined,
          endTime:
            typeof calendar.endTime === "string" || calendar.endTime === null
              ? calendar.endTime
              : undefined
        }
      };
    }
    const issue = this.toJsonObject(draft.issue);
    if (
      !issue ||
      typeof issue.boardId !== "string" ||
      typeof issue.columnId !== "string"
    ) {
      return null;
    }
    return {
      deliveryType,
      issue: {
        boardId: issue.boardId,
        columnId: issue.columnId,
        title: typeof issue.title === "string" ? issue.title : undefined,
        body: typeof issue.body === "string" ? issue.body : undefined
      }
    };
  }

  private toJsonObject(value: unknown): Record<string, unknown> | null {
    const parsed = typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            return null;
          }
        })()
      : value;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  }

  private isConstraintError(error: unknown, constraint: string): boolean {
    const candidate = error as { code?: unknown; constraint?: unknown };
    return (
      candidate.code === UNIQUE_VIOLATION_CODE &&
      candidate.constraint === constraint
    );
  }

  private toIsoString(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  private toDate(value: Date | string): Date {
    return value instanceof Date ? value : new Date(value);
  }

  private toNullableIsoString(value: Date | string | null): string | null {
    return value === null ? null : this.toIsoString(value);
  }
}
