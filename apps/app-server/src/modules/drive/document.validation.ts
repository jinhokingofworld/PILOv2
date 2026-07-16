import { badRequest } from "../../common/api-error";

import type {
  CreateDocumentRequest,
  DocumentJson,
  NormalizedCreateDocumentInput,
  NormalizedSaveDocumentSnapshotInput,
  SaveDocumentSnapshotRequest
} from "./document.types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_DOCUMENT_NAME = "새 문서";
const MAX_DRIVE_ITEM_NAME_LENGTH = 255;
const MAX_DOCUMENT_SNAPSHOT_BYTES = 1024 * 1024;
const MAX_DOCUMENT_JSON_BYTES = 512 * 1024;

export function validateCreateDocumentRequest(
  body: CreateDocumentRequest
): NormalizedCreateDocumentInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw badRequest("Request body must be an object");
  }

  const draft = body as Record<string, unknown>;
  const parentId = readOptionalParentId(draft.parentId);
  const name = readOptionalName(draft.name);

  return { name, parentId };
}

export function validateSaveDocumentSnapshotRequest(
  body: SaveDocumentSnapshotRequest
): NormalizedSaveDocumentSnapshotInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw badRequest("Request body must be an object");
  }

  const draft = body as Record<string, unknown>;
  const expectedVersion = readExpectedVersion(draft.expectedVersion);
  const yjsState = readYjsState(draft.yjsState);
  const contentJson = readDocumentJson(draft.contentJson);

  return {
    expectedVersion,
    yjsState,
    contentJson,
    plainText: extractPlainText(contentJson),
    attachmentFileIds: extractDriveFileAttachmentIds(contentJson)
  };
}

export function extractDriveFileAttachmentIds(contentJson: DocumentJson): string[] {
  const attachmentFileIds = new Set<string>();
  collectDriveFileAttachmentIds(contentJson, attachmentFileIds);
  return [...attachmentFileIds];
}

function readOptionalParentId(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw badRequest("Drive parentId is invalid");
  }

  return value;
}

function readOptionalName(value: unknown): string {
  if (value === undefined) {
    return DEFAULT_DOCUMENT_NAME;
  }
  if (typeof value !== "string") {
    throw badRequest("Drive item name is invalid");
  }

  const name = value.trim();
  if (!name || name.length > MAX_DRIVE_ITEM_NAME_LENGTH) {
    throw badRequest("Drive item name is invalid");
  }
  if (name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
    throw badRequest("Drive item name is invalid");
  }

  return name;
}

function readExpectedVersion(value: unknown): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value < 0) {
    throw badRequest("Document expectedVersion is invalid");
  }

  return value;
}

function readYjsState(value: unknown): Buffer {
  if (typeof value !== "string" || value.length === 0) {
    throw badRequest("Document yjsState is invalid");
  }

  const normalized = value.trim();
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)) {
    throw badRequest("Document yjsState is invalid");
  }

  const decoded = Buffer.from(normalized, "base64");
  if (
    decoded.length === 0 ||
    decoded.length > MAX_DOCUMENT_SNAPSHOT_BYTES ||
    decoded.toString("base64") !== normalized
  ) {
    throw badRequest("Document yjsState is invalid");
  }

  return decoded;
}

function readDocumentJson(value: unknown): DocumentJson {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw badRequest("Document contentJson is invalid");
  }

  const contentJson = value as DocumentJson;
  if (contentJson.type !== "doc") {
    throw badRequest("Document contentJson is invalid");
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(contentJson);
  } catch {
    throw badRequest("Document contentJson is invalid");
  }

  if (Buffer.byteLength(serialized, "utf8") > MAX_DOCUMENT_JSON_BYTES) {
    throw badRequest("Document contentJson is invalid");
  }

  return contentJson;
}

function extractPlainText(contentJson: DocumentJson): string {
  const textParts: string[] = [];
  collectText(contentJson, textParts);
  return textParts.join(" ").replace(/\s+/g, " ").trim();
}

function collectText(value: unknown, textParts: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, textParts);
    return;
  }
  if (typeof value !== "object" || value === null) return;

  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") textParts.push(record.text);
  if (Array.isArray(record.content)) collectText(record.content, textParts);
}

function collectDriveFileAttachmentIds(value: unknown, attachmentFileIds: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectDriveFileAttachmentIds(item, attachmentFileIds);
    return;
  }
  if (typeof value !== "object" || value === null) return;

  const record = value as Record<string, unknown>;
  if (record.type === "driveFileAttachment") {
    if (
      !hasOnlyKeys(record, ["type", "attrs"]) ||
      typeof record.attrs !== "object" ||
      record.attrs === null ||
      Array.isArray(record.attrs)
    ) {
      throw badRequest("Document attachment is invalid");
    }

    const attrs = record.attrs;
    const attachmentAttrs = attrs as Record<string, unknown>;
    if (!hasOnlyKeys(attachmentAttrs, ["driveItemId"])) {
      throw badRequest("Document attachment is invalid");
    }

    const driveItemId = attachmentAttrs.driveItemId;

    if (typeof driveItemId !== "string" || !UUID_PATTERN.test(driveItemId)) {
      throw badRequest("Document attachment is invalid");
    }

    attachmentFileIds.add(driveItemId);
  }

  if (Array.isArray(record.content)) {
    collectDriveFileAttachmentIds(record.content, attachmentFileIds);
  }
}

function hasOnlyKeys(record: Record<string, unknown>, allowedKeys: string[]): boolean {
  return Object.keys(record).every((key) => allowedKeys.includes(key));
}
