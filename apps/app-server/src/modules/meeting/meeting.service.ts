import { HttpStatus, Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import {
  ApiError,
  badRequest,
  forbidden,
  notFound
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

type RecordingStatus = "RUNNING" | "COMPLETED" | "FAILED";
type MeetingReportStatus = "PROCESSING" | "COMPLETED" | "FAILED";
type MeetingReportFailedStep = "RECORDING" | "STT" | "LLM";

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
  summary: string | null;
  discussion_points: string | null;
  decisions: string | null;
  action_item_candidates: unknown;
  retry_count: number | string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface MeetingReportDetailRow extends MeetingReportRow {
  transcript_text: string | null;
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

interface QueryOneExecutor {
  queryOne<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<T | null>;
}

interface MeetingReportListQuery {
  status?: unknown;
  limit?: unknown;
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
}

interface LeaveMeetingTransactionResult {
  payload: LeaveMeetingPayload;
  job: MeetingReportJobPayload | null;
}

interface MeetingReportRegenerationTransactionResult {
  payload: MeetingReportRegenerationPayload;
  job: MeetingReportJobPayload;
  previousReport: MeetingReportRegenerationRow;
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

export interface MeetingReportSummaryPayload {
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
  createdAt: string;
  updatedAt: string;
}

export interface MeetingReportDetailPayload extends MeetingReportSummaryPayload {
  transcriptText: string | null;
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
  reports: MeetingReportSummaryPayload[];
}

export interface MeetingReportDetailResponsePayload {
  report: MeetingReportDetailPayload;
}

export interface MeetingReportRegenerationPayload {
  report: MeetingReportSummaryPayload;
}

const MAIN_MEETING_ROOM = "MAIN_MEETING_ROOM";
const UNIQUE_VIOLATION_CODE = "23505";
const ACTIVE_MEETING_UNIQUE_INDEX = "unique_active_meeting_per_room";
const MEETING_ALREADY_IN_PROGRESS_ERROR_CODE =
  "MEETING_ALREADY_IN_PROGRESS";
const MEETING_ALREADY_IN_PROGRESS_MESSAGE = "A meeting is already in progress";
const SAFE_EGRESS_START_ERROR = "LiveKit Egress start failed";
const SAFE_EGRESS_STOP_ERROR = "LiveKit Egress stop failed";
const DEFAULT_MEETING_REPORT_LIMIT = 20;
const MAX_MEETING_REPORT_LIMIT = 100;
const MEETING_REPORT_STATUSES: readonly MeetingReportStatus[] = [
  "PROCESSING",
  "COMPLETED",
  "FAILED"
];
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class MeetingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly workspaceService: WorkspaceService,
    private readonly liveKitTokenService: LiveKitTokenService,
    private readonly liveKitEgressService: LiveKitEgressService,
    private readonly meetingReportJobService: MeetingReportJobService
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
      throw this.meetingAlreadyInProgress();
    }

    try {
      return await this.database.transaction(async (transaction) => {
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
      });
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
    meetingId: string
  ): Promise<JoinMeetingPayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    return this.database.transaction(async (transaction) => {
      const meeting = await this.findMeetingById(transaction, workspaceId, meetingId, {
        lockMeeting: true
      });

      if (!meeting) {
        throw notFound("Meeting not found");
      }

      if (meeting.ended_at !== null) {
        throw badRequest("Meeting has already ended");
      }

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
    const currentUserParticipant = await this.findParticipant(
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

        const existingParticipant = await this.findParticipant(
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
          meetingId,
          currentUserId
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
          job: reportPreparation.job
        };
      }
    );

    try {
      await this.enqueueMeetingReportJob(result.job);
    } catch (error) {
      if (result.job !== null) {
        await this.restoreLeaveMeetingAfterReportEnqueueFailure({
          workspaceId,
          meetingId,
          currentUserId,
          reportId: result.job.reportId
        });
      }

      throw error;
    }

    return result.payload;
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

      return {
        meeting: this.mapMeeting(prepared.meeting),
        recording: this.mapRecording(recording)
      };
    } catch (error) {
      await this.stopStartedEgressAfterPersistenceFailure(livekitEgressId);
      await this.markRecordingFailedAfterPersistenceFailure(prepared.recording);
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
          job: reportPreparation.job
        };
      }
    );

    await this.enqueueMeetingReportJob(result.job);
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
    const status = this.normalizeMeetingReportStatus(query.status);
    const limit = this.normalizeMeetingReportLimit(query.limit);
    const reports = await this.listWorkspaceMeetingReportRows(
      workspaceId,
      status,
      limit
    );

    return {
      reports: reports.map((report) => this.mapMeetingReportSummary(report))
    };
  }

  async getReport(
    currentUserId: string,
    workspaceId: string,
    reportId: string
  ): Promise<MeetingReportDetailResponsePayload> {
    await this.assertWorkspaceAccess(currentUserId, workspaceId);
    const report = await this.findMeetingReportDetailById(workspaceId, reportId);

    if (report === null) {
      throw notFound("Meeting report not found");
    }

    return {
      report: this.mapMeetingReportDetail(report)
    };
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
    if (report.status === "PROCESSING") {
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
          meeting_reports.transcript_text,
          meeting_reports.summary,
          meeting_reports.discussion_points,
          meeting_reports.decisions,
          meeting_reports.action_item_candidates,
          meeting_reports.retry_count,
          meeting_reports.created_at,
          meeting_reports.updated_at,
          meeting_recordings.status AS recording_status,
          meeting_recordings.audio_file_key AS recording_audio_file_key
        FROM meeting_reports
        JOIN meetings
          ON meetings.id = meeting_reports.meeting_id
        JOIN meeting_recordings
          ON meeting_recordings.id = meeting_reports.recording_id
          AND meeting_recordings.meeting_id = meeting_reports.meeting_id
        WHERE meetings.workspace_id = $1
          AND meeting_reports.id = $2
        FOR UPDATE OF meeting_reports
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
          status = 'PROCESSING',
          failed_step = NULL,
          error_message = NULL,
          transcript_text = NULL,
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
          summary,
          discussion_points,
          decisions,
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
            transcript_text = $5,
            summary = $6,
            discussion_points = $7,
            decisions = $8,
            action_item_candidates = $9::jsonb,
            retry_count = $10,
            updated_at = now()
          WHERE id = $1
            AND status = 'PROCESSING'
          RETURNING
            id,
            meeting_id,
            recording_id,
            status,
            failed_step,
            error_message,
            summary,
            discussion_points,
            decisions,
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
          report.transcript_text,
          report.summary,
          report.discussion_points,
          report.decisions,
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

  private async assertWorkspaceAccess(
    currentUserId: string,
    workspaceId: string
  ): Promise<void> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
  }

  private meetingAlreadyInProgress() {
    return new ApiError(
      HttpStatus.BAD_REQUEST,
      MEETING_ALREADY_IN_PROGRESS_ERROR_CODE,
      MEETING_ALREADY_IN_PROGRESS_MESSAGE
    );
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
    return {
      report: result.report,
      job:
        result.inserted && recording.audio_file_key !== null
          ? this.buildMeetingReportJobPayload(result.report, recording)
          : null
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
          summary,
          discussion_points,
          decisions,
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
        VALUES ($1, $2, 'PROCESSING')
        ON CONFLICT (recording_id) DO NOTHING
        RETURNING
          id,
          meeting_id,
          recording_id,
          status,
          failed_step,
          error_message,
          summary,
          discussion_points,
          decisions,
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
            summary = NULL,
            discussion_points = NULL,
            decisions = NULL,
            action_item_candidates = '[]'::jsonb,
            updated_at = now()
          WHERE id = $1
            AND status = 'PROCESSING'
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
          id,
          meeting_id,
          recording_id,
          status,
          failed_step,
          error_message,
          summary,
          discussion_points,
          decisions,
          action_item_candidates,
          retry_count,
          created_at,
          updated_at
        FROM meeting_reports
        WHERE meeting_id = $1
        ORDER BY created_at DESC, id ASC
      `,
      [meetingId]
    );
  }

  private async listWorkspaceMeetingReportRows(
    workspaceId: string,
    status: MeetingReportStatus | null,
    limit: number
  ): Promise<MeetingReportRow[]> {
    const values: unknown[] = [workspaceId];
    const statusCondition =
      status === null
        ? ""
        : `AND meeting_reports.status = $${values.push(status)}`;
    const limitParameter = `$${values.push(limit)}`;

    return this.database.query<MeetingReportRow>(
      `
        SELECT
          meeting_reports.id,
          meeting_reports.meeting_id,
          meeting_reports.recording_id,
          meeting_reports.status,
          meeting_reports.failed_step,
          meeting_reports.error_message,
          meeting_reports.summary,
          meeting_reports.discussion_points,
          meeting_reports.decisions,
          meeting_reports.action_item_candidates,
          meeting_reports.retry_count,
          meeting_reports.created_at,
          meeting_reports.updated_at
        FROM meeting_reports
        JOIN meetings
          ON meetings.id = meeting_reports.meeting_id
        WHERE meetings.workspace_id = $1
          ${statusCondition}
        ORDER BY meeting_reports.created_at DESC, meeting_reports.id ASC
        LIMIT ${limitParameter}
      `,
      values
    );
  }

  private async findMeetingReportDetailById(
    workspaceId: string,
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
          meeting_reports.summary,
          meeting_reports.discussion_points,
          meeting_reports.decisions,
          meeting_reports.action_item_candidates,
          meeting_reports.retry_count,
          meeting_reports.created_at,
          meeting_reports.updated_at
        FROM meeting_reports
        JOIN meetings
          ON meetings.id = meeting_reports.meeting_id
        WHERE meetings.workspace_id = $1
          AND meeting_reports.id = $2
        LIMIT 1
      `,
      [workspaceId, reportId]
    );
  }

  private async countParticipants(
    meetingId: string
  ): Promise<{ participantCount: number; activeParticipantCount: number }> {
    const result = await this.database.queryOne<ParticipantCountRow>(
      `
        SELECT
          COUNT(*)::int AS participant_count,
          (COUNT(*) FILTER (WHERE left_at IS NULL))::int AS active_participant_count
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
        ORDER BY meeting_participants.joined_at ASC, meeting_participants.id ASC
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
        WITH upserted_participant AS (
          INSERT INTO meeting_participants (
            meeting_id,
            user_id,
            livekit_identity
          )
          VALUES (
            $1::uuid,
            $2::uuid,
            'meeting-' || ($1::uuid)::text || '-user-' || ($2::uuid)::text
          )
          ON CONFLICT (meeting_id, user_id)
          DO UPDATE SET
            joined_at = now(),
            left_at = NULL,
            livekit_identity = EXCLUDED.livekit_identity,
            updated_at = now()
          RETURNING *
        )
        SELECT
          upserted_participant.id,
          upserted_participant.meeting_id,
          upserted_participant.user_id,
          upserted_participant.livekit_identity,
          upserted_participant.joined_at,
          upserted_participant.left_at,
          users.name AS user_name,
          users.avatar_url AS user_avatar_url
        FROM upserted_participant
        JOIN users
          ON users.id = upserted_participant.user_id
      `,
      [meetingId, currentUserId]
    );

    if (!participant) {
      throw badRequest("Meeting participant could not be saved");
    }

    return participant;
  }

  private async findParticipant(
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
        JOIN users
          ON users.id = meeting_participants.user_id
        WHERE meeting_participants.meeting_id = $1
          AND meeting_participants.user_id = $2
        LIMIT 1
      `,
      [meetingId, currentUserId]
    );
  }

  private async assertActiveParticipant(
    executor: QueryOneExecutor,
    meetingId: string,
    currentUserId: string
  ): Promise<void> {
    const participant = await this.findParticipant(
      executor,
      meetingId,
      currentUserId
    );

    if (!participant || participant.left_at !== null) {
      throw forbidden("Current user is not an active meeting participant");
    }
  }

  private async markParticipantLeft(
    executor: QueryOneExecutor,
    meetingId: string,
    currentUserId: string
  ): Promise<ParticipantRow> {
    const participant = await executor.queryOne<ParticipantRow>(
      `
        WITH updated_participant AS (
          UPDATE meeting_participants
          SET
            left_at = COALESCE(left_at, now()),
            updated_at = CASE
              WHEN left_at IS NULL THEN now()
              ELSE updated_at
            END
          WHERE meeting_id = $1
            AND user_id = $2
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
      [meetingId, currentUserId]
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
  ): Promise<void> {
    try {
      await this.database.transaction((transaction) =>
        this.updateRecordingFailed(
          transaction,
          recording,
          SAFE_EGRESS_START_ERROR
        )
      );
    } catch {
      // Best effort cleanup: the original persistence error remains the API result.
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
    return {
      id: report.id,
      meetingId: report.meeting_id,
      recordingId: report.recording_id,
      status: report.status,
      failedStep: report.failed_step,
      errorMessage: report.error_message,
      summary: report.summary,
      discussionPoints: report.discussion_points,
      decisions: report.decisions,
      actionItemCandidates: this.toJsonArray(report.action_item_candidates),
      retryCount: Number(report.retry_count),
      createdAt: this.toIsoString(report.created_at),
      updatedAt: this.toIsoString(report.updated_at)
    };
  }

  private mapMeetingReportDetail(
    report: MeetingReportDetailRow
  ): MeetingReportDetailPayload {
    return {
      ...this.mapMeetingReportSummary(report),
      transcriptText: report.transcript_text
    };
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
}
