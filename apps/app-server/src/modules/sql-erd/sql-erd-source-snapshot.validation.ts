import { badRequest } from "../../common/api-error";
import {
  validateCreateSqlErdSessionRequest,
  validateSqlErdSessionId
} from "./sql-erd.validation";
import {
  NormalizedSqlErdSourcePublishInput,
  NormalizedSqlErdSourceLockInput,
  NormalizedSqlErdSourceSnapshotBatchInput,
  AcquireSqlErdSourceLockRequest,
  ReleaseSqlErdSourceLockRequest,
  RenewSqlErdSourceLockRequest,
  SqlErdJsonObject,
  SourcePublishRequest,
  SourceSnapshotBatchQuery
} from "./sql-erd.types";

const SOURCE_PUBLISH_FIELDS = new Set([
  "baseRevision",
  "clientOperationId",
  "dialect",
  "leaseId",
  "modelJson",
  "sourceFormat",
  "sourceText"
]);
const MAX_BATCH_QUERY_LENGTH = 2_048;
const MAX_BATCH_SNAPSHOT_IDS = 3;
const MAX_CLIENT_OPERATION_ID_LENGTH = 128;

export function validateAcquireSqlErdSourceLockRequest(
  body: AcquireSqlErdSourceLockRequest
): NormalizedSqlErdSourceLockInput {
  return validateSourceLockRequest(body);
}

export function validateRenewSqlErdSourceLockRequest(
  body: RenewSqlErdSourceLockRequest
): NormalizedSqlErdSourceLockInput {
  return validateSourceLockRequest(body);
}

export function validateReleaseSqlErdSourceLockRequest(
  body: ReleaseSqlErdSourceLockRequest
): NormalizedSqlErdSourceLockInput {
  return validateSourceLockRequest(body);
}

export function validateSqlErdSourcePublishRequest(
  body: SourcePublishRequest
): NormalizedSqlErdSourcePublishInput {
  const draft = readObject(body, "Request body");
  assertAllowedFields(draft, SOURCE_PUBLISH_FIELDS, "Request body");

  const normalizedSession = validateCreateSqlErdSessionRequest({
    dialect: draft.dialect,
    layoutJson: { tableLayouts: [], version: 1 },
    modelJson: draft.modelJson,
    sourceFormat: draft.sourceFormat,
    sourceText: draft.sourceText,
    title: "Source snapshot"
  });

  return {
    baseRevision: readPositiveInteger(draft.baseRevision, "baseRevision"),
    clientOperationId: readClientOperationId(draft.clientOperationId),
    dialect: normalizedSession.dialect,
    leaseId: validateSqlErdSessionId(draft.leaseId),
    modelJson: normalizedSession.modelJson,
    sourceFormat: normalizedSession.sourceFormat,
    sourceText: normalizedSession.sourceText
  };
}

export function validateSqlErdSourceSnapshotBatchQuery(
  query: SourceSnapshotBatchQuery
): NormalizedSqlErdSourceSnapshotBatchInput {
  const draft = readObject(query, "Query");
  assertAllowedFields(draft, new Set(["ids"]), "Query");
  if (typeof draft.ids !== "string") {
    throw badRequest("ids must be a comma-separated string");
  }
  if (draft.ids.length > MAX_BATCH_QUERY_LENGTH) {
    throw badRequest("ids query is too long");
  }

  const ids = Array.from(
    new Set(draft.ids.split(",").filter((id) => id.length > 0).map(validateSqlErdSessionId))
  );
  if (ids.length < 1 || ids.length > MAX_BATCH_SNAPSHOT_IDS) {
    throw badRequest("ids count must be between 1 and 3");
  }
  return { ids };
}

function readObject(value: unknown, field: string): SqlErdJsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw badRequest(`${field} must be an object`);
  }
  return value as SqlErdJsonObject;
}

function validateSourceLockRequest(
  body:
    | AcquireSqlErdSourceLockRequest
    | RenewSqlErdSourceLockRequest
    | ReleaseSqlErdSourceLockRequest
): NormalizedSqlErdSourceLockInput {
  const draft = readObject(body, "Request body");
  assertAllowedFields(draft, new Set(["leaseId"]), "Request body");
  return { leaseId: validateSqlErdSessionId(draft.leaseId) };
}

function assertAllowedFields(
  value: SqlErdJsonObject,
  allowedFields: ReadonlySet<string>,
  field: string
): void {
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      throw badRequest(`${field} has unknown field`);
    }
  }
}

function readPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw badRequest(`${field} must be a positive integer`);
  }
  return value;
}

function readClientOperationId(value: unknown): string {
  if (typeof value !== "string") {
    throw badRequest("clientOperationId must be a string");
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_CLIENT_OPERATION_ID_LENGTH) {
    throw badRequest("clientOperationId length is invalid");
  }
  return normalized;
}
