import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";

export type PendingMeetingPayload = never;

type RecordingStatus = "RUNNING" | "COMPLETED" | "FAILED";

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

interface CurrentMeetingRow extends MeetingRow {
  recording_id: string | null;
  recording_meeting_id: string | null;
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

interface MeetingReportListQuery {
  status?: string;
  limit?: string;
}

interface StartMeetingDraft {
  roomKey?: unknown;
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

export interface CurrentMeetingPayload {
  meeting: MeetingPayload | null;
  currentRecording: RecordingPayload | null;
  activeParticipantCount: number;
}

export interface StartMeetingPayload {
  meeting: MeetingPayload;
  participant: ParticipantPayload;
  livekit: null;
  currentRecording: null;
}

const MAIN_MEETING_ROOM = "MAIN_MEETING_ROOM";
const UNIQUE_VIOLATION_CODE = "23505";
const ACTIVE_MEETING_UNIQUE_INDEX = "unique_active_meeting_per_room";

@Injectable()
export class MeetingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly workspaceService: WorkspaceService
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

  async startMeeting(
    currentUserId: string,
    workspaceId: string,
    body: unknown
  ): Promise<StartMeetingPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    const roomKey = this.normalizeStartMeetingBody(body).roomKey;

    const existingMeeting = await this.findCurrentMeeting(workspaceId, roomKey);
    if (existingMeeting) {
      throw badRequest("A meeting is already in progress");
    }

    let startedMeeting: StartMeetingRow | null;
    try {
      startedMeeting = await this.database.queryOne<StartMeetingRow>(
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
              $1,
              $2,
              'meeting-' || generated.meeting_id::text,
              $3
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
              $3,
              'meeting-' || inserted_meeting.id::text || '-user-' || $3::text
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
    } catch (error) {
      if (this.isConstraintError(error, ACTIVE_MEETING_UNIQUE_INDEX)) {
        throw badRequest("A meeting is already in progress");
      }

      throw error;
    }

    if (!startedMeeting) {
      throw badRequest("Meeting could not be started");
    }

    return this.mapStartMeeting(startedMeeting);
  }

  async joinMeeting(
    currentUserId: string,
    workspaceId: string,
    _meetingId: string
  ): Promise<PendingMeetingPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    return this.pendingEndpoint(
      "POST /workspaces/{workspaceId}/meetings/{meetingId}/participants/me"
    );
  }

  async getMeeting(
    currentUserId: string,
    workspaceId: string,
    _meetingId: string
  ): Promise<PendingMeetingPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    return this.pendingEndpoint("GET /workspaces/{workspaceId}/meetings/{meetingId}");
  }

  async leaveMeeting(
    currentUserId: string,
    workspaceId: string,
    _meetingId: string
  ): Promise<PendingMeetingPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    return this.pendingEndpoint(
      "DELETE /workspaces/{workspaceId}/meetings/{meetingId}/participants/me"
    );
  }

  async startRecording(
    currentUserId: string,
    workspaceId: string,
    _meetingId: string
  ): Promise<PendingMeetingPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    return this.pendingEndpoint(
      "POST /workspaces/{workspaceId}/meetings/{meetingId}/recordings"
    );
  }

  async endRecordingAndCreateReport(
    currentUserId: string,
    workspaceId: string,
    _meetingId: string,
    _recordingId: string
  ): Promise<PendingMeetingPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    return this.pendingEndpoint(
      "POST /workspaces/{workspaceId}/meetings/{meetingId}/recordings/{recordingId}/end"
    );
  }

  async listRecordings(
    currentUserId: string,
    workspaceId: string,
    _meetingId: string
  ): Promise<PendingMeetingPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    return this.pendingEndpoint(
      "GET /workspaces/{workspaceId}/meetings/{meetingId}/recordings"
    );
  }

  async getCurrentRecording(
    currentUserId: string,
    workspaceId: string,
    _meetingId: string
  ): Promise<PendingMeetingPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    return this.pendingEndpoint(
      "GET /workspaces/{workspaceId}/meetings/{meetingId}/recordings/current"
    );
  }

  async listParticipants(
    currentUserId: string,
    workspaceId: string,
    _meetingId: string
  ): Promise<PendingMeetingPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    return this.pendingEndpoint(
      "GET /workspaces/{workspaceId}/meetings/{meetingId}/participants"
    );
  }

  async listReports(
    currentUserId: string,
    workspaceId: string,
    _query: MeetingReportListQuery
  ): Promise<PendingMeetingPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    return this.pendingEndpoint("GET /workspaces/{workspaceId}/meeting-reports");
  }

  async getReport(
    currentUserId: string,
    workspaceId: string,
    _reportId: string
  ): Promise<PendingMeetingPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    return this.pendingEndpoint(
      "GET /workspaces/{workspaceId}/meeting-reports/{reportId}"
    );
  }

  async listMeetingReports(
    currentUserId: string,
    workspaceId: string,
    _meetingId: string
  ): Promise<PendingMeetingPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    return this.pendingEndpoint(
      "GET /workspaces/{workspaceId}/meetings/{meetingId}/reports"
    );
  }

  async requestReportRegeneration(
    currentUserId: string,
    workspaceId: string,
    _reportId: string
  ): Promise<PendingMeetingPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    return this.pendingEndpoint(
      "POST /workspaces/{workspaceId}/meeting-reports/{reportId}/regeneration-jobs"
    );
  }

  private async assertWorkspaceAccess(
    currentUserId: string,
    workspaceId: string
  ): Promise<void> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
  }

  private async findCurrentMeeting(
    workspaceId: string,
    roomKey: string
  ): Promise<CurrentMeetingRow | null> {
    return this.database.queryOne<CurrentMeetingRow>(
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

  private normalizeStartMeetingBody(body: unknown): { roomKey: string } {
    if (body === undefined || body === null) {
      return { roomKey: MAIN_MEETING_ROOM };
    }

    if (typeof body !== "object" || Array.isArray(body)) {
      throw badRequest("Request body must be an object");
    }

    const draft = body as StartMeetingDraft;
    if (draft.roomKey === undefined || draft.roomKey === null) {
      return { roomKey: MAIN_MEETING_ROOM };
    }

    if (typeof draft.roomKey !== "string") {
      throw badRequest("roomKey must be a string");
    }

    const roomKey = draft.roomKey.trim();
    if (roomKey !== MAIN_MEETING_ROOM) {
      throw badRequest("roomKey must be MAIN_MEETING_ROOM");
    }

    return { roomKey };
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
    if (row.recording_id === null || row.recording_meeting_id === null) {
      return null;
    }

    if (row.recording_started_at === null || row.recording_status === null) {
      return null;
    }

    return {
      id: row.recording_id,
      meetingId: row.recording_meeting_id,
      status: row.recording_status,
      audioFileUrl: row.recording_audio_file_url,
      audioFileKey: row.recording_audio_file_key,
      durationSec: row.recording_duration_sec,
      fileSizeBytes:
        row.recording_file_size_bytes === null
          ? null
          : Number(row.recording_file_size_bytes),
      startedAt: this.toIsoString(row.recording_started_at),
      endedAt: this.toNullableIsoString(row.recording_ended_at),
      errorMessage: row.recording_error_message
    };
  }

  private mapStartMeeting(row: StartMeetingRow): StartMeetingPayload {
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
      livekit: null,
      currentRecording: null
    };
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

  private toNullableIsoString(value: Date | string | null): string | null {
    return value === null ? null : this.toIsoString(value);
  }

  private pendingEndpoint(endpoint: string): PendingMeetingPayload {
    throw badRequest(`${endpoint} is not implemented yet`);
  }
}
