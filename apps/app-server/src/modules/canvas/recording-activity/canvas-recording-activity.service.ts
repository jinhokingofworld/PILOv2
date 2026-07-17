import { BadRequestException, Injectable } from "@nestjs/common";
import { ActivityLogService } from "../../../common/activity-log.service";
import type { DatabaseTransaction } from "../../../database/database.service";
import { DatabaseService } from "../../../database/database.service";
import {
  buildCanvasRecordingActivityLog,
} from "../operation/canvas-activity-log";

type RecordingActivityBatchInput = {
  activities?: unknown;
};

type RecordingActivityRow = {
  actor_user_id: string;
  canvas_id: string;
  captured_at: string;
  capture_id: string;
  changed_fields: string[] | null;
  language: string | null;
  operation_type: "create" | "update" | "delete";
  receive_seq: number | string;
  shape_id: string;
  shape_type: string;
  text_preview: string | null;
  title: string | null;
  workspace_id: string;
  recording_id: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BATCH_SIZE = 100;

@Injectable()
export class CanvasRecordingActivityService {
  constructor(
    private readonly activityLogService: ActivityLogService,
    private readonly database: DatabaseService
  ) {}

  async appendBatch(body: RecordingActivityBatchInput): Promise<{ accepted: number }> {
    const rows = this.normalizeRows(body.activities);
    if (rows.length === 0) return { accepted: 0 };

    let accepted = 0;
    await this.database.transaction(async transaction => {
      for (const row of rows) {
        const inserted = await this.appendOne(transaction, row);
        if (inserted) accepted += 1;
      }
    });

    return { accepted };
  }

  private async appendOne(
    transaction: DatabaseTransaction,
    row: RecordingActivityRow
  ): Promise<boolean> {
    const capturedAt = new Date(row.captured_at);
    if (!Number.isFinite(capturedAt.getTime())) return false;

    let recording = await transaction.queryOne<{
      id: string;
      ended_at: Date | string | null;
      meeting_id: string;
      started_at: Date | string;
      status: string;
      workspace_id: string;
    }>(
      `
        SELECT r.id, r.meeting_id, r.status, r.started_at, r.ended_at,
               m.workspace_id
        FROM meeting_recordings r
        JOIN meetings m ON m.id = r.meeting_id
        WHERE r.id = $1
          AND m.workspace_id = $2
      `,
      [row.recording_id, row.workspace_id]
    );
    if (!recording) return false;

    if (recording.status === "RUNNING") {
      const activeRecordings = await transaction.query<{ id: string }>(
        `
          SELECT r.id
          FROM meeting_recordings r
          JOIN meetings m ON m.id = r.meeting_id
          WHERE m.workspace_id = $1
            AND r.status = 'RUNNING'
            AND EXISTS (
              SELECT 1
              FROM meeting_participants p
              WHERE p.meeting_id = r.meeting_id
                AND p.user_id = $2
                AND p.left_at IS NULL
                AND p.is_legacy_session = false
            )
          ORDER BY r.id
          FOR UPDATE OF r
        `,
        [row.workspace_id, row.actor_user_id]
      );
      if (activeRecordings.length !== 1 || activeRecordings[0]?.id !== row.recording_id) {
        return false;
      }
    }

    const lockedRecording = await transaction.queryOne<{
      id: string;
      ended_at: Date | string | null;
      meeting_id: string;
      started_at: Date | string;
      status: string;
      workspace_id: string;
    }>(
      `
        SELECT r.id, r.meeting_id, r.status, r.started_at, r.ended_at,
               m.workspace_id
        FROM meeting_recordings r
        JOIN meetings m ON m.id = r.meeting_id
        WHERE r.id = $1
          AND m.workspace_id = $2
        FOR UPDATE OF r
      `,
      [row.recording_id, row.workspace_id]
    );
    if (!lockedRecording) return false;
    recording = lockedRecording;

    const recordingStartedAt = new Date(recording.started_at);
    const recordingEndedAt = recording.ended_at === null ? null : new Date(recording.ended_at);
    const capturedDuringRecording =
      capturedAt.getTime() >= recordingStartedAt.getTime() &&
      (recordingEndedAt === null || capturedAt.getTime() < recordingEndedAt.getTime());
    if (!capturedDuringRecording) return false;
    if (capturedAt.getTime() > Date.now() + 5_000) return false;
    if (recording.status !== "RUNNING" && recordingEndedAt === null) return false;

    const participant = await transaction.queryOne<{ id: string }>(
      `
        SELECT id
        FROM meeting_participants
        WHERE meeting_id = $1
          AND user_id = $2
          AND is_legacy_session = false
          AND joined_at <= $3::timestamptz
          AND (left_at IS NULL OR $3::timestamptz < left_at)
        ORDER BY joined_at DESC, id DESC
        LIMIT 1
      `,
      [recording.meeting_id, row.actor_user_id, row.captured_at]
    );
    if (!participant) return false;

    const canvas = await transaction.queryOne<{ id: string }>(
      `
        SELECT id
        FROM canvas
        WHERE id = $1
          AND workspace_id = $2
          AND board_type = 'freeform'
          AND engine_type = 'classic'
      `,
      [row.canvas_id, row.workspace_id]
    );
    if (!canvas) return false;

    const activity = buildCanvasRecordingActivityLog({
      actorUserId: row.actor_user_id,
      captureId: row.capture_id,
      canvasId: row.canvas_id,
      changedFields: row.changed_fields ?? undefined,
      language: row.language ?? undefined,
      operationType: row.operation_type,
      shapeId: row.shape_id,
      shapeType: row.shape_type,
      textPreview: row.text_preview ?? undefined,
      title: row.title ?? undefined,
      workspaceId: row.workspace_id
    });
    if (!activity) return false;

    const existingLink = await transaction.queryOne<{ activity_log_id: string }>(
      `
        SELECT activity_log_id
        FROM meeting_recording_activity_links
        WHERE capture_id = $1
        FOR SHARE
      `,
      [row.capture_id]
    );
    if (existingLink) return false;

    await this.activityLogService.append(transaction, activity);
    const activityLog = await transaction.queryOne<{ id: string }>(
      `
        SELECT id
        FROM activity_logs
        WHERE workspace_id = $1
          AND dedupe_key = $2
        LIMIT 1
      `,
      [activity.workspaceId, activity.dedupeKey]
    );
    if (!activityLog) return false;

    const link = await transaction.queryOne<{ id: string }>(
      `
        INSERT INTO meeting_recording_activity_links (
          recording_id, activity_log_id, capture_id, captured_at, receive_seq
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (capture_id) DO NOTHING
        RETURNING id
      `,
      [row.recording_id, activityLog.id, row.capture_id, row.captured_at, row.receive_seq]
    );

    return link !== null;
  }

  private normalizeRows(value: unknown): RecordingActivityRow[] {
    if (!Array.isArray(value) || value.length > MAX_BATCH_SIZE) {
      throw new BadRequestException("Canvas recording activity batch is invalid");
    }

    return value.map((candidate, index) => {
      if (!isRecord(candidate)) throw new BadRequestException(`Canvas recording activity ${index} is invalid`);
      const row = candidate as Record<string, unknown>;
      const result: RecordingActivityRow = {
        actor_user_id: readUuid(row.actorUserId, "actorUserId"),
        canvas_id: readUuid(row.canvasId, "canvasId"),
        captured_at: readString(row.capturedAt, "capturedAt"),
        capture_id: readBoundedString(row.captureId, "captureId", 512),
        changed_fields: readOptionalStringArray(row.changedFields),
        language: readOptionalString(row.language),
        operation_type: readOperationType(row.operationType),
        receive_seq: readPositiveInteger(row.receiveSeq, "receiveSeq"),
        shape_id: readBoundedString(row.shapeId, "shapeId", 512),
        shape_type: readBoundedString(row.shapeType, "shapeType", 128),
        text_preview: readOptionalString(row.textPreview),
        title: readOptionalString(row.title),
        workspace_id: readUuid(row.workspaceId, "workspaceId"),
        recording_id: readUuid(row.recordingId, "recordingId")
      };
      return result;
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new BadRequestException(`${name} is invalid`);
  return value.trim();
}

function readBoundedString(value: unknown, name: string, max: number): string {
  const result = readString(value, name);
  if (result.length > max) throw new BadRequestException(`${name} is invalid`);
  return result;
}

function readUuid(value: unknown, name: string): string {
  const result = readString(value, name);
  if (!UUID_PATTERN.test(result)) throw new BadRequestException(`${name} is invalid`);
  return result;
}

function readOptionalString(value: unknown): string | null {
  return value === undefined || value === null ? null : readBoundedString(value, "string", 500);
}

function readOptionalStringArray(value: unknown): string[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.some(item => typeof item !== "string" || item.length > 64)) {
    throw new BadRequestException("changedFields is invalid");
  }
  return value as string[];
}

function readPositiveInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new BadRequestException(`${name} is invalid`);
  }
  return value;
}

function readOperationType(value: unknown): RecordingActivityRow["operation_type"] {
  if (value === "create" || value === "update" || value === "delete") return value;
  throw new BadRequestException("operationType is invalid");
}
