import { isDeepStrictEqual } from "node:util";
import type { ActivityLogInput } from "../../common/activity-log.service";
import type { SqlErdJsonObject, SqlErdSessionRow } from "./sql-erd.types";

const MAX_TITLE_LENGTH = 160;
const MAX_NOTE_CONTENT_SUMMARY_LENGTH = 500;
const SENSITIVE_CONTENT_PATTERNS = [
  /(?:api[_ -]?key|authorization|oauth|password|passwd|private[_ -]?key|pwd|secret|token)\s*[:=]\s*\S+/iu,
  /(?:api[_ -]?key|authorization|oauth|password|passwd|private[_ -]?key|pwd|secret|token)\s+(?:is|are|는|은|이|가)\s+\S+/iu,
  /(?:비밀번호|암호|토큰|비밀[_ ]?키|시크릿|인증[_ ]?키|api[_ ]?키)\s*(?:[:=]|(?:은|는|이|가)\s*)\S+/iu,
  /\b[a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:[^@\s/]+@/iu,
  /\bbearer\s+[a-z0-9._~+/=-]{8,}\b/iu,
  /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/u,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u,
  /\bgh[pousr]_[a-z0-9]{20,}\b/iu,
  /\bgithub_pat_[a-z0-9_]{20,}\b/iu,
  /\bglpat-[a-z0-9_-]{10,}\b/iu,
  /\bsk-[a-z0-9_-]{16,}\b/iu,
  /\b(?:sk|rk)_(?:live|test)_[a-z0-9]{16,}\b/iu,
  /\bwhsec_[a-z0-9]{16,}\b/iu,
  /\bxox[baprs]-[a-z0-9-]{10,}\b/iu,
  /\beyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\b/iu
];

export interface SqlErdActivityActor {
  type: "agent" | "user";
  userId: string;
}

interface SessionActivityArguments {
  workspaceId: string;
  actor: SqlErdActivityActor;
  session: SqlErdSessionRow;
}

interface SessionChangedActivityArguments {
  workspaceId: string;
  actor: SqlErdActivityActor;
  before: SqlErdSessionRow;
  after: SqlErdSessionRow;
}

interface NoteActivityArguments {
  workspaceId: string;
  sessionId: string;
  actor: SqlErdActivityActor;
  beforeLayout: SqlErdJsonObject;
  afterLayout: SqlErdJsonObject;
  resultRevision: number;
}

interface SqlErdNoteSnapshot {
  id: string;
  text: string;
}

export function buildSqlErdSessionCreatedActivity({
  workspaceId,
  actor,
  session
}: SessionActivityArguments): ActivityLogInput {
  return {
    workspaceId,
    actor,
    action: "sql_erd_session_created",
    target: { type: "sql_erd_session", id: session.id },
    dedupeKey: createDedupeKey(
      "sql_erd_session_created",
      session.id,
      session.revision
    ),
    metadata: {
      version: 1,
      summary: "SQLtoERD 세션을 생성했습니다.",
      data: {
        title: createSafeTitle(session.title),
        dialect: session.dialect,
        tableCount: Number(session.table_count),
        relationCount: Number(session.relation_count)
      }
    }
  };
}

export function buildSqlErdSessionCreatedActivities(
  arguments_: SessionActivityArguments
): ActivityLogInput[] {
  const { workspaceId, actor, session } = arguments_;
  return [
    buildSqlErdSessionCreatedActivity(arguments_),
    ...buildSqlErdNoteActivities({
      workspaceId,
      sessionId: session.id,
      actor,
      beforeLayout: {},
      afterLayout: session.layout_json,
      resultRevision: Number(session.revision)
    })
  ];
}

export function buildSqlErdSessionChangedActivities({
  workspaceId,
  actor,
  before,
  after
}: SessionChangedActivityArguments): ActivityLogInput[] {
  const activities: ActivityLogInput[] = [];
  const changedFields: string[] = [];

  if (before.source_text !== after.source_text) changedFields.push("sourceText");
  if (!isDeepStrictEqual(before.model_json, after.model_json)) {
    changedFields.push("modelJson");
  }
  if (before.dialect !== after.dialect) changedFields.push("dialect");

  if (changedFields.length > 0) {
    activities.push({
      workspaceId,
      actor,
      action: "sql_erd_schema_updated",
      target: { type: "sql_erd_session", id: after.id },
      dedupeKey: createDedupeKey(
        "sql_erd_schema_updated",
        after.id,
        after.revision
      ),
      metadata: {
        version: 1,
        summary: "SQLtoERD 스키마를 갱신했습니다.",
        data: {
          title: createSafeTitle(after.title),
          changedFields,
          dialect: after.dialect,
          beforeCounts: {
            tableCount: Number(before.table_count),
            relationCount: Number(before.relation_count)
          },
          afterCounts: {
            tableCount: Number(after.table_count),
            relationCount: Number(after.relation_count)
          }
        }
      }
    });
  }

  if (before.title !== after.title) {
    activities.push({
      workspaceId,
      actor,
      action: "sql_erd_session_renamed",
      target: { type: "sql_erd_session", id: after.id },
      dedupeKey: createDedupeKey(
        "sql_erd_session_renamed",
        after.id,
        after.revision
      ),
      metadata: {
        version: 1,
        summary: "SQLtoERD 세션 이름을 변경했습니다.",
        data: {
          title: createSafeTitle(after.title),
          previousTitle: createSafeTitle(before.title)
        }
      }
    });
  }

  return [
    ...activities,
    ...buildSqlErdNoteActivities({
      workspaceId,
      sessionId: after.id,
      actor,
      beforeLayout: before.layout_json,
      afterLayout: after.layout_json,
      resultRevision: Number(after.revision)
    })
  ];
}

export function buildSqlErdSessionDeletedActivity({
  workspaceId,
  actor,
  session
}: SessionActivityArguments): ActivityLogInput {
  return {
    workspaceId,
    actor,
    action: "sql_erd_session_deleted",
    target: { type: "sql_erd_session", id: session.id },
    dedupeKey: createDedupeKey(
      "sql_erd_session_deleted",
      session.id,
      session.revision
    ),
    metadata: {
      version: 1,
      summary: "SQLtoERD 세션을 삭제했습니다.",
      data: {
        title: createSafeTitle(session.title),
        tableCount: Number(session.table_count),
        relationCount: Number(session.relation_count)
      }
    }
  };
}

export function buildSqlErdNoteActivities({
  workspaceId,
  sessionId,
  actor,
  beforeLayout,
  afterLayout,
  resultRevision
}: NoteActivityArguments): ActivityLogInput[] {
  const beforeNotes = extractNotes(beforeLayout);
  const afterNotes = extractNotes(afterLayout);
  const activities: ActivityLogInput[] = [];

  for (const [noteId, afterNote] of afterNotes) {
    const beforeNote = beforeNotes.get(noteId);
    if (!beforeNote) {
      if (normalizeText(afterNote.text).length === 0) continue;
      activities.push(
        createNoteContentActivity({
          workspaceId,
          sessionId,
          note: afterNote,
          actor,
          action: "sql_erd_note_created",
          resultRevision
        })
      );
      continue;
    }

    if (normalizeText(beforeNote.text) !== normalizeText(afterNote.text)) {
      activities.push(
        createNoteContentActivity({
          workspaceId,
          sessionId,
          note: afterNote,
          actor,
          action: "sql_erd_note_updated",
          resultRevision
        })
      );
    }
  }

  for (const [noteId, beforeNote] of beforeNotes) {
    if (afterNotes.has(noteId) || normalizeText(beforeNote.text).length === 0) {
      continue;
    }
    activities.push({
      workspaceId,
      actor,
      action: "sql_erd_note_deleted",
      target: { type: "sql_erd_note", id: createNoteTargetId(sessionId, noteId) },
      dedupeKey: createDedupeKey(
        "sql_erd_note_deleted",
        createNoteTargetId(sessionId, noteId),
        resultRevision
      ),
      metadata: {
        version: 1,
        summary: "ERD 검토 메모를 삭제했습니다.",
        data: { sessionId }
      }
    });
  }

  return activities;
}

function createNoteContentActivity({
  workspaceId,
  sessionId,
  note,
  actor,
  action,
  resultRevision
}: {
  workspaceId: string;
  sessionId: string;
  note: SqlErdNoteSnapshot;
  actor: SqlErdActivityActor;
  action: "sql_erd_note_created" | "sql_erd_note_updated";
  resultRevision: number;
}): ActivityLogInput {
  const normalizedText = normalizeText(note.text);
  const contentOmitted = containsSensitiveContent(normalizedText);
  const contentProjection = truncateUnicode(
    normalizedText,
    MAX_NOTE_CONTENT_SUMMARY_LENGTH
  );
  return {
    workspaceId,
    actor,
    action,
    target: {
      type: "sql_erd_note",
      id: createNoteTargetId(sessionId, note.id)
    },
    dedupeKey: createDedupeKey(
      action,
      createNoteTargetId(sessionId, note.id),
      resultRevision
    ),
    metadata: {
      version: 1,
      summary:
        action === "sql_erd_note_created"
          ? "ERD 검토 메모를 추가했습니다."
          : "ERD 검토 메모를 수정했습니다.",
      data: {
        sessionId,
        contentSummary: contentOmitted
          ? ""
          : contentProjection.value,
        truncated: contentProjection.truncated,
        contentOmitted
      }
    }
  };
}

function extractNotes(layout: SqlErdJsonObject): Map<string, SqlErdNoteSnapshot> {
  const annotations = isRecord(layout.annotations) ? layout.annotations : null;
  const notes = annotations && Array.isArray(annotations.notes) ? annotations.notes : [];
  const result = new Map<string, SqlErdNoteSnapshot>();

  for (const value of notes) {
    if (!isRecord(value) || typeof value.id !== "string") continue;
    result.set(value.id, {
      id: value.id,
      text: typeof value.text === "string" ? value.text : ""
    });
  }
  return result;
}

function createSafeTitle(title: string): string {
  const normalized = normalizeText(title);
  if (containsSensitiveContent(normalized)) return "제목 비공개";
  return truncateUnicode(normalized, MAX_TITLE_LENGTH).value || "제목 없음";
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function containsSensitiveContent(value: string): boolean {
  return SENSITIVE_CONTENT_PATTERNS.some((pattern) => pattern.test(value));
}

function createNoteTargetId(sessionId: string, noteId: string): string {
  return `${sessionId}:${noteId}`;
}

function truncateUnicode(
  value: string,
  maxLength: number
): { value: string; truncated: boolean } {
  const codePoints = Array.from(value);
  return {
    value: codePoints.slice(0, maxLength).join(""),
    truncated: codePoints.length > maxLength
  };
}

function createDedupeKey(
  action: ActivityLogInput["action"],
  targetId: string,
  revision: number | string
): string {
  return `sqltoerd:${action}:${targetId}:${Number(revision)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
