import { badRequest } from "../../common/api-error";
import {
  CreateDriveFolderRequest,
  NormalizedCreateDriveFolderInput,
  NormalizedDriveParentInput,
  NormalizedUpdateDriveItemInput,
  UpdateDriveItemRequest
} from "./drive.types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DRIVE_ITEM_NAME_LENGTH = 255;

export function validateDriveItemId(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw badRequest("Drive item id is invalid");
  }

  return value;
}

export function validateListDriveItemsQuery(
  parentId: unknown
): NormalizedDriveParentInput {
  return {
    parentId: readOptionalParentId(parentId)
  };
}

export function validateCreateDriveFolderRequest(
  body: CreateDriveFolderRequest
): NormalizedCreateDriveFolderInput {
  const draft = readBody(body);

  return {
    parentId: readOptionalParentId(draft.parentId),
    name: readDriveItemName(draft.name)
  };
}

export function validateUpdateDriveItemRequest(
  body: UpdateDriveItemRequest
): NormalizedUpdateDriveItemInput {
  const draft = readBody(body);

  return {
    name: readDriveItemName(draft.name)
  };
}

function readBody(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw badRequest("Request body must be an object");
  }

  return body as Record<string, unknown>;
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

function readDriveItemName(value: unknown): string {
  if (typeof value !== "string") {
    throw badRequest("Drive item name is required");
  }

  const name = value.trim();
  if (!name) {
    throw badRequest("Drive item name is required");
  }

  if (name.length > MAX_DRIVE_ITEM_NAME_LENGTH) {
    throw badRequest("Drive item name must be 255 characters or less");
  }

  if (name === "." || name === "..") {
    throw badRequest("Drive item name is reserved");
  }

  if (name.includes("/") || name.includes("\\")) {
    throw badRequest("Drive item name cannot include path separators");
  }

  return name;
}
