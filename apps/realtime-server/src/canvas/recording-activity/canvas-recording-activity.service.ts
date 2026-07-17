import type { RealtimeDatabase } from "../../database/database";
import type { CanvasRoomRef } from "../contracts/canvas-types";
import type { CanvasRoomShapeActivityCandidate } from "../state/canvas-room-state.service";

const RECORDING_CACHE_TTL_MS = 500;
const TEXT_BURST_IDLE_MS = 3_000;
const TEXT_BURST_MAX_MS = 30_000;
const RETRY_DELAY_MS = 1_000;
const TEXT_PREVIEW_MAX_LENGTH = 160;
const CODE_LANGUAGES = new Set(["tsx", "ts", "jsx", "js", "json", "css", "html", "md", "sql", "py", "c"]);
const TRACKED_SHAPE_TYPES = new Set(["sticky-note", "note", "text", "frame", "pilo-code-block", "arrow", "line"]);
const SENSITIVE_TEXT_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bBearer\s+\S+/i,
  /\b(?:gh[pousr]_|github_pat_|sk-)[A-Za-z0-9_-]{16,}\b/i,
  /\b(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|password)\s*[:=]\s*\S+/i
];

type RecordingRow = { recordingId: string };
type CachedRecording = {
  capturedAtMs: number;
  expiresAt: number;
  recording: RecordingRow | null;
};
type SafeProjection = {
  language?: string;
  shapeType: string;
  textPreview?: string;
  title?: string;
  textValue: string | null;
};
type BufferedActivity = {
  actorUserId: string;
  canvasId: string;
  captureId: string;
  capturedAt: string;
  changedFields?: string[];
  language?: string;
  operationType: "create" | "update" | "delete";
  receiveSeq: number;
  recordingId: string;
  shapeId: string;
  shapeType: string;
  textPreview?: string;
  title?: string;
  idleTimer?: ReturnType<typeof setTimeout>;
  lastCapturedAt: string;
  maxTimer?: ReturnType<typeof setTimeout>;
  textValue: string | null;
  workspaceId: string;
};

export type CanvasRecordingActivityService = {
  capture: (
    room: CanvasRoomRef,
    actorUserId: string,
    candidate: CanvasRoomShapeActivityCandidate
  ) => void;
  close: () => Promise<void>;
  flushAll: () => Promise<void>;
  flushRoom: (room: CanvasRoomRef) => Promise<void>;
  invalidateWorkspace: (workspaceId: string) => void;
};

export function createCanvasRecordingActivityService({
  appServerUrl,
  database,
  token
}: {
  appServerUrl: string;
  database: RealtimeDatabase;
  token: string | null;
}): CanvasRecordingActivityService {
  const recordingCache = new Map<string, CachedRecording>();
  const buffered = new Map<string, BufferedActivity>();
  const pendingSends = new Map<string, BufferedActivity[]>();
  const pendingDrainPromises = new Map<string, Promise<void>>();
  let isClosing = false;

  function cacheKey(workspaceId: string, actorUserId: string) {
    return `${workspaceId}:${actorUserId}`;
  }

  async function resolveRecording(
    workspaceId: string,
    actorUserId: string,
    capturedAt: string,
  ): Promise<RecordingRow | null> {
    const key = cacheKey(workspaceId, actorUserId);
    const capturedAtMs = Date.parse(capturedAt);
    const cached = recordingCache.get(key);
    if (
      cached &&
      cached.expiresAt > Date.now() &&
      Math.abs(cached.capturedAtMs - capturedAtMs) <= RECORDING_CACHE_TTL_MS
    ) {
      return cached.recording;
    }

    try {
      const rows = await database.query<RecordingRow>(
        `
          SELECT meeting_recordings.id AS "recordingId"
          FROM meeting_recordings
          JOIN meetings ON meetings.id = meeting_recordings.meeting_id
          WHERE meetings.workspace_id = $1
            AND meeting_recordings.started_at <= $3::timestamptz
            AND (
              meeting_recordings.ended_at IS NULL
              OR $3::timestamptz < meeting_recordings.ended_at
            )
            AND EXISTS (
              SELECT 1
              FROM meeting_participants
              WHERE meeting_participants.meeting_id = meeting_recordings.meeting_id
                AND meeting_participants.user_id = $2
                AND meeting_participants.is_legacy_session = false
                AND meeting_participants.joined_at <= $3::timestamptz
                AND (
                  meeting_participants.left_at IS NULL
                  OR $3::timestamptz < meeting_participants.left_at
                )
            )
          ORDER BY meeting_recordings.started_at ASC, meeting_recordings.id ASC
        `,
        [workspaceId, actorUserId, capturedAt]
      );
      const recording = rows.length === 1 ? rows[0] ?? null : null;
      recordingCache.set(key, {
        capturedAtMs,
        expiresAt: Date.now() + RECORDING_CACHE_TTL_MS,
        recording,
      });
      return recording;
    } catch (error) {
      console.warn("Canvas recording resolver failed.", { error, workspaceId });
      return null;
    }
  }

  function projectShape(shape: Record<string, unknown> | null): SafeProjection | null {
    if (!shape) return null;
    const props = readRecord(shape.props);
    const shapeType = typeof shape.type === "string" ? shape.type : "";
    if (!shapeType || !TRACKED_SHAPE_TYPES.has(shapeType)) return null;

    const title = typeof props.name === "string"
      ? props.name
      : typeof props.fileName === "string"
        ? props.fileName
        : undefined;
    const textValue = typeof props.text === "string"
      ? props.text
      : typeof props.code === "string"
        ? props.code
        : readRichTextPlainText(props.richText);
    const languageValue = props.language;
    const language = typeof languageValue === "string" && CODE_LANGUAGES.has(languageValue)
      ? languageValue
      : undefined;

    return {
      ...(language ? { language } : {}),
      shapeType,
      ...(safeText(title) ? { title: safeText(title) ?? undefined } : {}),
      ...(safeText(textValue) ? { textPreview: safeText(textValue) ?? undefined } : {}),
      textValue
    };
  }

  function semanticChangedFields(before: SafeProjection | null, after: SafeProjection | null): string[] {
    if (!before || !after) return [];
    const fields: string[] = [];
    if (before.title !== after.title) fields.push(after.shapeType === "frame" ? "name" : "title");
    if (before.textValue !== after.textValue) fields.push(after.shapeType === "pilo-code-block" ? "code" : "text");
    if (before.language !== after.language) fields.push("language");
    return fields;
  }

  function isTextOnly(fields: string[]) {
    return fields.length === 1 && (fields[0] === "text" || fields[0] === "code");
  }

  async function send(entries: BufferedActivity[]): Promise<boolean> {
    if (!entries.length) return true;
    if (!token) return false;

    try {
      const response = await fetch(`${appServerUrl}/internal/canvas/recording-activities/batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Realtime-Canvas-Activity-Token": token
        },
        body: JSON.stringify({
          activities: entries.map(entry => ({
            actorUserId: entry.actorUserId,
            canvasId: entry.canvasId,
            captureId: entry.captureId,
            capturedAt: entry.capturedAt,
            ...(entry.changedFields ? { changedFields: entry.changedFields } : {}),
            ...(entry.language ? { language: entry.language } : {}),
            operationType: entry.operationType,
            receiveSeq: entry.receiveSeq,
            recordingId: entry.recordingId,
            shapeId: entry.shapeId,
            shapeType: entry.shapeType,
            ...(entry.textPreview ? { textPreview: entry.textPreview } : {}),
            ...(entry.title ? { title: entry.title } : {}),
            workspaceId: entry.workspaceId
          }))
        })
      });
      return response.ok;
    } catch (error) {
      console.warn("Canvas recording activity handoff failed.", { error });
      return false;
    }
  }

  function entryKey(entry: Pick<BufferedActivity, "actorUserId" | "canvasId" | "recordingId" | "shapeId">) {
    return `${entry.recordingId}:${entry.actorUserId}:${entry.canvasId}:${entry.shapeId}`;
  }

  async function drainPending(key: string): Promise<void> {
    const activeDrain = pendingDrainPromises.get(key);
    if (activeDrain) return activeDrain;

    const drain = (async () => {
      const queue = pendingSends.get(key) ?? [];
      while (queue.length) {
        const entry = queue[0];
        const sent = await send([entry]);
        if (sent || isClosing) {
          queue.shift();
          continue;
        }
        setTimeout(() => {
          pendingDrainPromises.delete(key);
          void drainPending(key);
        }, RETRY_DELAY_MS);
        return;
      }
      pendingSends.delete(key);
      pendingDrainPromises.delete(key);
    })();
    pendingDrainPromises.set(key, drain);
    await drain;
  }

  async function flushEntry(key: string, expectedEntry?: BufferedActivity) {
    const currentEntry = buffered.get(key);
    const entry = expectedEntry ?? currentEntry;
    if (!entry) return;
    clearEntryTimers(entry);
    if (currentEntry === entry) buffered.delete(key);

    const queue = pendingSends.get(key) ?? [];
    if (!queue.includes(entry)) queue.push(entry);
    pendingSends.set(key, queue);
    await drainPending(key);
  }

  function clearEntryTimers(entry: BufferedActivity) {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    if (entry.maxTimer) clearTimeout(entry.maxTimer);
    entry.idleTimer = undefined;
    entry.maxTimer = undefined;
  }

  function scheduleEntryTimers(key: string, entry: BufferedActivity) {
    entry.idleTimer = setTimeout(() => void flushEntry(key), TEXT_BURST_IDLE_MS);
    entry.maxTimer = setTimeout(() => void flushEntry(key), TEXT_BURST_MAX_MS);
  }

  function capture(room: CanvasRoomRef, actorUserId: string, candidate: CanvasRoomShapeActivityCandidate) {
    if (isClosing || !actorUserId || actorUserId === "unknown") return;
    const capturedAt = new Date().toISOString();
    const before = projectShape(candidate.before);
    const after = projectShape(candidate.after);
    const projection = candidate.operationType === "delete" ? before : after;
    if (!projection) return;

    const changedFields = candidate.operationType === "update"
      ? semanticChangedFields(before, after)
      : [];
    if (candidate.operationType === "update" && changedFields.length === 0) return;

    void resolveRecording(room.workspaceId, actorUserId, capturedAt).then(recording => {
      if (!recording || isClosing) return;
      const operationType = candidate.operationType;
      const initial: BufferedActivity = {
        actorUserId,
        canvasId: room.canvasId,
        captureId: `canvas:${room.workspaceId}:${room.canvasId}:${actorUserId}:${recording.recordingId}:${candidate.receiveSeq}`,
        capturedAt,
        ...(changedFields.length ? { changedFields } : {}),
        ...(projection.language ? { language: projection.language } : {}),
        operationType,
        receiveSeq: candidate.receiveSeq,
        recordingId: recording.recordingId,
        shapeId: candidate.shapeId,
        shapeType: projection.shapeType,
        ...(projection.textPreview ? { textPreview: projection.textPreview } : {}),
        ...(projection.title ? { title: projection.title } : {}),
        lastCapturedAt: capturedAt,
        textValue: projection.textValue,
        workspaceId: room.workspaceId
      };
      const key = entryKey(initial);
      const existing = buffered.get(key);
      if (
        existing &&
        existing.operationType === "update" &&
        operationType === "update" &&
        isTextOnly(existing.changedFields ?? []) &&
        isTextOnly(changedFields) &&
        Date.parse(capturedAt) - Date.parse(existing.lastCapturedAt) <= TEXT_BURST_IDLE_MS &&
        Date.parse(capturedAt) - Date.parse(existing.capturedAt) < TEXT_BURST_MAX_MS
      ) {
        if (existing.idleTimer) clearTimeout(existing.idleTimer);
        existing.changedFields = changedFields;
        existing.lastCapturedAt = capturedAt;
        existing.textPreview = projection.textPreview;
        existing.textValue = projection.textValue;
        existing.idleTimer = setTimeout(() => void flushEntry(key), TEXT_BURST_IDLE_MS);
        return;
      }

      if (existing) {
        buffered.delete(key);
        void flushEntry(key, existing);
      }
      buffered.set(key, initial);
      scheduleEntryTimers(key, initial);
    });
  }

  async function flushRoom(room: CanvasRoomRef) {
    const entries = [...buffered.entries()].filter(([, entry]) => entry.canvasId === room.canvasId && entry.workspaceId === room.workspaceId);
    await Promise.all(entries.map(([key]) => flushEntry(key)));
  }

  return {
    capture,
    async close() {
      isClosing = true;
      buffered.forEach(clearEntryTimers);
      await Promise.all([...new Set([...buffered.keys(), ...pendingSends.keys()])].map(key => flushEntry(key)));
      buffered.clear();
      pendingSends.clear();
      pendingDrainPromises.clear();
      recordingCache.clear();
    },
    async flushAll() {
      await Promise.all([...new Set([...buffered.keys(), ...pendingSends.keys()])].map(key => flushEntry(key)));
    },
    flushRoom,
    invalidateWorkspace(workspaceId) {
      for (const key of recordingCache.keys()) {
        if (key.startsWith(`${workspaceId}:`)) recordingCache.delete(key);
      }
    }
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readRichTextPlainText(value: unknown): string | null {
  const richText = readRecord(value);
  const content = richText.content;
  if (!Array.isArray(content)) return null;
  const text = content.flatMap(node => {
    const paragraph = readRecord(node);
    const children = paragraph.content;
    return Array.isArray(children)
      ? children.flatMap(child => {
          const textNode = readRecord(child);
          return typeof textNode.text === "string" ? [textNode.text] : [];
        })
      : [];
  }).join("\n").trim();
  return text || null;
}

function safeText(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || SENSITIVE_TEXT_PATTERNS.some(pattern => pattern.test(normalized))) return null;
  return normalized.slice(0, TEXT_PREVIEW_MAX_LENGTH);
}
