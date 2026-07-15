import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ACTIVE_SNAPSHOT_SESSION_PREDICATE =
  "write_protocol = 'snapshot' AND deleted_at IS NULL";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RETENTION_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;
export async function validateSqlErdOperationsV1CutoverManifest({
  artifactPath,
  manifest,
}) {
  assertManifestObject(manifest);
  const createdAt = parseTimestamp(manifest.createdAt, "createdAt");
  const deleteAfter = parseTimestamp(
    manifest.retention?.deleteAfter,
    "retention.deleteAfter",
  );
  const retentionMilliseconds = deleteAfter.getTime() - createdAt.getTime();
  if (retentionMilliseconds !== MAX_RETENTION_MILLISECONDS)
    throw new Error("cutover manifest retention must be exactly seven days");
  if (
    manifest.scope?.activeSessionPredicate !== ACTIVE_SNAPSHOT_SESSION_PREDICATE
  )
    throw new Error(
      "cutover manifest must use the active snapshot session predicate",
    );
  const sessionIds = manifest.scope.sessionIds;
  if (!Array.isArray(sessionIds))
    throw new Error("cutover manifest scope.sessionIds must be an array");
  if (!Number.isInteger(manifest.scope.rowCount))
    throw new Error("cutover manifest scope.rowCount must be an integer");
  if (manifest.scope.rowCount !== sessionIds.length)
    throw new Error("cutover manifest rowCount must match sessionIds");
  if (new Set(sessionIds).size !== sessionIds.length)
    throw new Error("cutover manifest sessionIds must be unique");
  if (!sessionIds.every((sessionId) => UUID_PATTERN.test(sessionId)))
    throw new Error("cutover manifest sessionIds must contain UUID values");
  const normalizedSessionIds = sessionIds.map((sessionId) =>
    sessionId.toLowerCase(),
  );
  if (
    normalizedSessionIds.some(
      (sessionId, index) =>
        index > 0 && normalizedSessionIds[index - 1] >= sessionId,
    )
  ) {
    throw new Error("cutover manifest sessionIds must be sorted");
  }
  const artifact = manifest.artifact;
  if (
    !artifact ||
    artifact.encryption !== "age" ||
    typeof artifact.fileName !== "string" ||
    artifact.fileName !== path.basename(artifactPath) ||
    !SHA256_PATTERN.test(artifact.sha256 ?? "")
  )
    throw new Error("cutover manifest encrypted artifact metadata is invalid");
  if (typeof manifest.storageLocation !== "string" || !manifest.storageLocation)
    throw new Error("cutover manifest storageLocation is required");
  const actualChecksum = createHash("sha256")
    .update(await readFile(artifactPath))
    .digest("hex");
  if (actualChecksum !== artifact.sha256)
    throw new Error("cutover manifest artifact checksum does not match");
  return {
    activeSnapshotSessionCount: sessionIds.length,
    deleteAfter: deleteAfter.toISOString(),
    sessionIds,
    storageLocation: manifest.storageLocation,
  };
}
function assertManifestObject(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
    throw new Error("cutover manifest must be an object");
  if (manifest.version !== 1)
    throw new Error("cutover manifest version must be 1");
}
function parseTimestamp(value, fieldName) {
  if (typeof value !== "string")
    throw new Error(`cutover manifest ${fieldName} must be an ISO timestamp`);
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime()) || timestamp.toISOString() !== value)
    throw new Error(`cutover manifest ${fieldName} must be an ISO timestamp`);
  return timestamp;
}
async function main() {
  const options = parseArguments(process.argv.slice(2));
  const result = await validateSqlErdOperationsV1CutoverManifest({
    artifactPath: options.artifactPath,
    manifest: JSON.parse(await readFile(options.manifestPath, "utf8")),
  });
  console.log(JSON.stringify(result));
}
function parseArguments(argumentsList) {
  const values = new Map();
  for (let index = 0; index < argumentsList.length; index += 2)
    values.set(argumentsList[index], argumentsList[index + 1]);
  const manifestPath = values.get("--manifest");
  const artifactPath = values.get("--artifact");
  if (
    argumentsList.length !== 4 ||
    !manifestPath ||
    !artifactPath ||
    values.size !== 2
  )
    throw new Error(
      "Usage: node operations-v1-cutover-manifest.mjs --manifest <path> --artifact <path>",
    );
  return { artifactPath, manifestPath };
}
const isDirectExecution =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
