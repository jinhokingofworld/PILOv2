import { badRequest } from "../../common/api-error";

import type {
  CreateDocumentRequest,
  NormalizedCreateDocumentInput
} from "./document.types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_DOCUMENT_NAME = "새 문서";
const MAX_DRIVE_ITEM_NAME_LENGTH = 255;

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
