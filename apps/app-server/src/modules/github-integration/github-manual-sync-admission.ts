import { createHash } from "node:crypto";
import { badRequest } from "../../common/api-error";
import type { GithubSyncTarget } from "./types";

export interface GithubManualSyncAdmissionConfig {
  userLimit: number;
  workspaceLimit: number;
  rateWindowSeconds: number;
  cooldownSeconds: number;
  maxQueuedJobs: number;
}

export interface GithubManualSyncScope {
  installationId: string;
  repositoryId: string | null;
  projectV2Id: string | null;
  target: GithubSyncTarget;
}

const PRINTABLE_ASCII_KEY_PATTERN = /^[\x20-\x7e]+$/;
const MAX_IDEMPOTENCY_KEY_BYTES = 128;
const INVALID_IDEMPOTENCY_KEY_MESSAGE =
  "Idempotency-Key must be printable ASCII between 1 and 128 bytes";

export function readGithubManualSyncIdempotencyKey(value: unknown): string {
  if (typeof value !== "string") {
    throw badRequest(INVALID_IDEMPOTENCY_KEY_MESSAGE);
  }

  const keyByteLength = Buffer.byteLength(value, "utf8");
  if (
    keyByteLength < 1 ||
    keyByteLength > MAX_IDEMPOTENCY_KEY_BYTES ||
    !PRINTABLE_ASCII_KEY_PATTERN.test(value) ||
    /^ +$/.test(value)
  ) {
    throw badRequest(INVALID_IDEMPOTENCY_KEY_MESSAGE);
  }

  return value;
}

export function hashGithubManualSyncIdempotencyKey(value: string): string {
  return hashGithubManualSyncValue(value);
}

export function fingerprintGithubManualSyncScope(scope: GithubManualSyncScope): string {
  return hashGithubManualSyncValue(JSON.stringify({
    installationId: scope.installationId,
    repositoryId: scope.repositoryId,
    projectV2Id: scope.projectV2Id,
    target: scope.target
  }));
}

function hashGithubManualSyncValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
