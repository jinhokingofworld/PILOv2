import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const ACTIVE_SNAPSHOT_SESSION_PREDICATE =
  "write_protocol = 'snapshot' AND deleted_at IS NULL";
const CUTOVER_EXPORT_FORMAT = "sql_erd_sessions_ndjson_v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIN_POST_VALIDATION_RETENTION_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;
// Covers worst-case JSON escaping for the DB-valid 1 MiB source/model/layout fields.
const MAX_NDJSON_LINE_BYTES = 16 * 1024 * 1024;
const AGE_HEADER = Buffer.from("age-encryption.org/v1\n");
const RECOVERABLE_SESSION_COLUMNS = [
  "created_at",
  "created_by",
  "deleted_at",
  "dialect",
  "id",
  "latest_op_seq",
  "layout_json",
  "model_json",
  "relation_count",
  "revision",
  "settings_json",
  "source_format",
  "source_text",
  "table_count",
  "title",
  "updated_at",
  "updated_by",
  "workspace_id",
  "write_protocol",
];
const SQL_ERD_DIALECTS = new Set(["auto", "postgresql", "mysql", "sqlite"]);
const execFileAsync = promisify(execFile);

export async function validateSqlErdOperationsV1CutoverManifestMetadata({
  artifactPath,
  manifest,
  now = new Date(),
}) {
  assertManifestObject(manifest);
  const createdAt = parseTimestamp(manifest.createdAt, "createdAt");
  const deleteAfter = parseTimestamp(
    manifest.retention?.deleteAfter,
    "retention.deleteAfter",
  );
  const validationTime = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(validationTime.getTime()))
    throw new Error("cutover manifest validation time is invalid");
  if (createdAt.getTime() > validationTime.getTime())
    throw new Error("cutover manifest createdAt cannot be in the future");
  if (
    deleteAfter.getTime() - validationTime.getTime() <
    MIN_POST_VALIDATION_RETENTION_MILLISECONDS
  )
    throw new Error(
      "cutover manifest must retain the artifact for at least seven days after validation",
    );
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
  if (!sessionIds.every((sessionId) => UUID_PATTERN.test(sessionId)))
    throw new Error("cutover manifest sessionIds must contain UUID values");
  const normalizedSessionIds = sessionIds.map((sessionId) =>
    sessionId.toLowerCase(),
  );
  if (new Set(normalizedSessionIds).size !== normalizedSessionIds.length)
    throw new Error("cutover manifest sessionIds must be unique");
  if (
    normalizedSessionIds.some(
      (sessionId, index) =>
        index > 0 && normalizedSessionIds[index - 1] >= sessionId,
    )
  )
    throw new Error("cutover manifest sessionIds must be sorted");

  const sessionVersions = manifest.scope.sessionVersions;
  if (
    !Array.isArray(sessionVersions) ||
    sessionVersions.length !== normalizedSessionIds.length
  )
    throw new Error(
      "cutover manifest sessionVersions must match sessionIds",
    );
  for (let index = 0; index < sessionVersions.length; index += 1) {
    const version = sessionVersions[index];
    if (
      !isPlainObject(version) ||
      Object.keys(version).sort().join(",") !==
        "revision,sessionId,updatedAt" ||
      typeof version.sessionId !== "string" ||
      version.sessionId.toLowerCase() !== normalizedSessionIds[index] ||
      !Number.isInteger(version.revision) ||
      version.revision <= 0 ||
      !isTimestamp(version.updatedAt)
    )
      throw new Error(
        "cutover manifest sessionVersions contains an invalid session version",
      );
  }

  const artifact = manifest.artifact;
  if (
    !artifact ||
    artifact.encryption !== "age" ||
    artifact.exportFormat !== CUTOVER_EXPORT_FORMAT ||
    typeof artifact.fileName !== "string" ||
    artifact.fileName !== path.basename(artifactPath) ||
    !SHA256_PATTERN.test(artifact.sha256 ?? "")
  )
    throw new Error("cutover manifest encrypted artifact metadata is invalid");
  if (!isRestrictedStorageLocation(manifest.storageLocation))
    throw new Error(
      "cutover manifest storageLocation must be restricted storage",
    );

  const artifactBytes = await readFile(artifactPath);
  if (!artifactBytes.subarray(0, AGE_HEADER.length).equals(AGE_HEADER))
    throw new Error("cutover manifest artifact must be age-encrypted");
  const actualChecksum = createHash("sha256")
    .update(artifactBytes)
    .digest("hex");
  if (actualChecksum !== artifact.sha256)
    throw new Error("cutover manifest artifact checksum does not match");
  return {
    activeSnapshotSessionCount: sessionIds.length,
    deleteAfter: deleteAfter.toISOString(),
    sessionIds,
    sessionVersions,
    storageLocation: manifest.storageLocation,
  };
}

/**
 * Full deletion gate: validates the encrypted artifact, decrypts it with age,
 * and compares the recovered rows with the manifest before deleting plaintext.
 */
export async function verifySqlErdOperationsV1CutoverRecovery({
  artifactPath,
  manifest,
  decryptToPath = decryptSqlErdOperationsV1CutoverArtifactWithAge,
  identityPath,
  now = new Date(),
}) {
  const staticValidation = await validateSqlErdOperationsV1CutoverManifestMetadata({
    artifactPath,
    manifest,
    now,
  });
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "pilo-sqltoerd-cutover-recovery-"),
  );
  const plaintextPath = path.join(
    temporaryDirectory,
    "snapshot-sessions.ndjson",
  );
  try {
    await decryptToPath({
      artifactPath,
      identityPath,
      outputPath: plaintextPath,
    });
    const recoveredSessionIds = await validateRecoveredExport({
      plaintextPath,
      expectedSessionIds: staticValidation.sessionIds,
      expectedSessionVersions: staticValidation.sessionVersions,
    });
    return {
      ...staticValidation,
      recoveredSessionCount: recoveredSessionIds.length,
      recoveredSessionIds,
    };
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

export async function decryptSqlErdOperationsV1CutoverArtifactWithAge({
  artifactPath,
  identityPath,
  outputPath,
  runCommand = execFileAsync,
}) {
  if (typeof identityPath !== "string" || identityPath.length === 0)
    throw new Error("cutover recovery requires an age identity path");
  try {
    await runCommand(
      "age",
      [
        "--decrypt",
        "--identity",
        identityPath,
        "--output",
        outputPath,
        artifactPath,
      ],
      { windowsHide: true, maxBuffer: 1024 * 1024 },
    );
  } catch {
    throw new Error("cutover artifact age decryption failed");
  }
}

async function validateRecoveredExport({
  plaintextPath,
  expectedSessionIds,
  expectedSessionVersions,
}) {
  const plaintextBytes = await readFile(plaintextPath);
  let plaintext;
  try {
    plaintext = new TextDecoder("utf-8", { fatal: true }).decode(plaintextBytes);
  } catch {
    throw new Error("decrypted export must be valid UTF-8");
  }
  const lines = plaintext.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length === 0)
    throw new Error("decrypted export must contain at least one session row");

  const recoveredSessionIds = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (Buffer.byteLength(line, "utf8") > MAX_NDJSON_LINE_BYTES)
      throw new Error("decrypted export row is too large");
    let session;
    try {
      session = JSON.parse(line);
    } catch {
      throw new Error("decrypted export contains invalid NDJSON");
    }
    if (!isRecoverableSnapshotSessionRow(session))
      throw new Error(
        "decrypted export contains an incomplete or invalid snapshot session row",
      );
    const expectedVersion = expectedSessionVersions[index];
    if (
      session.revision !== expectedVersion.revision ||
      Date.parse(session.updated_at) !== Date.parse(expectedVersion.updatedAt)
    )
      throw new Error(
        "decrypted export row version does not match manifest",
      );
    recoveredSessionIds.push(session.id.toLowerCase());
  }

  if (
    recoveredSessionIds.length !== expectedSessionIds.length ||
    recoveredSessionIds.some(
      (id, index) => id !== expectedSessionIds[index].toLowerCase(),
    )
  )
    throw new Error("decrypted export rows do not match manifest session IDs");
  return recoveredSessionIds;
}

function isRecoverableSnapshotSessionRow(session) {
  if (!isPlainObject(session)) return false;
  const columns = Object.keys(session).sort();
  if (
    columns.length !== RECOVERABLE_SESSION_COLUMNS.length ||
    columns.some((column, index) => column !== RECOVERABLE_SESSION_COLUMNS[index])
  )
    return false;
  return (
    UUID_PATTERN.test(session.id) &&
    UUID_PATTERN.test(session.workspace_id) &&
    isNullableUuid(session.created_by) &&
    isNullableUuid(session.updated_by) &&
    typeof session.title === "string" &&
    session.title.length >= 1 &&
    session.title.length <= 120 &&
    session.source_format === "sql" &&
    SQL_ERD_DIALECTS.has(session.dialect) &&
    typeof session.source_text === "string" &&
    isPlainObject(session.model_json) &&
    isPlainObject(session.layout_json) &&
    isPlainObject(session.settings_json) &&
    Number.isInteger(session.table_count) &&
    session.table_count >= 0 &&
    session.table_count <= 100 &&
    Number.isInteger(session.relation_count) &&
    session.relation_count >= 0 &&
    session.relation_count <= 300 &&
    Number.isInteger(session.revision) &&
    session.revision > 0 &&
    isTimestamp(session.created_at) &&
    isTimestamp(session.updated_at) &&
    session.deleted_at === null &&
    session.write_protocol === "snapshot" &&
    Number.isSafeInteger(session.latest_op_seq) &&
    session.latest_op_seq >= 0
  );
}

function isNullableUuid(value) {
  return value === null || (typeof value === "string" && UUID_PATTERN.test(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isRestrictedStorageLocation(value) {
  if (
    typeof value !== "string" ||
    /\s/.test(value) ||
    /[?#]/.test(value)
  )
    return false;
  try {
    const location = new URL(value);
    return (
      (location.protocol === "s3:" || location.protocol === "vault:") &&
      location.hostname.length > 0 &&
      !location.username &&
      !location.password &&
      !location.search &&
      !location.hash
    );
  } catch {
    return false;
  }
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

export function summarizeSqlErdOperationsV1CutoverRecovery({ manifest, result }) {
  return {
    artifactSha256: manifest.artifact.sha256,
    deleteAfter: result.deleteAfter,
    recoveredSessionCount: result.recoveredSessionCount,
    recoveryVerified: true,
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(options.manifestPath, "utf8"));
  const result = await verifySqlErdOperationsV1CutoverRecovery({
    artifactPath: options.artifactPath,
    identityPath: options.identityPath,
    manifest,
  });
  console.log(
    JSON.stringify(
      summarizeSqlErdOperationsV1CutoverRecovery({ manifest, result }),
    ),
  );
}

function parseArguments(argumentsList) {
  const values = new Map();
  for (let index = 0; index < argumentsList.length; index += 2)
    values.set(argumentsList[index], argumentsList[index + 1]);
  const manifestPath = values.get("--manifest");
  const artifactPath = values.get("--artifact");
  const identityPath = values.get("--identity");
  if (
    argumentsList.length !== 6 ||
    !manifestPath ||
    !artifactPath ||
    !identityPath ||
    values.size !== 3
  )
    throw new Error(
      "Usage: node operations-v1-cutover-manifest.mjs --manifest <path> --artifact <path> --identity <path>",
    );
  return { artifactPath, identityPath, manifestPath };
}

const isDirectExecution =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
