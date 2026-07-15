import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateSqlErdOperationsV1CutoverManifest } from "./operations-v1-cutover-manifest.mjs";

const tempDirectory = await mkdtemp(
  path.join(os.tmpdir(), "pilo-sqltoerd-cutover-"),
);
const artifactPath = path.join(tempDirectory, "snapshot-sessions.sql.age");
const createdAt = "2026-07-15T09:00:00.000Z";
const sessionIds = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
];

try {
  const artifact = "encrypted snapshot export bytes";
  await writeFile(artifactPath, artifact, "utf8");

  const manifest = {
    version: 1,
    createdAt,
    scope: {
      activeSessionPredicate:
        "write_protocol = 'snapshot' AND deleted_at IS NULL",
      rowCount: sessionIds.length,
      sessionIds,
    },
    artifact: {
      fileName: path.basename(artifactPath),
      encryption: "age",
      sha256: createHash("sha256").update(artifact).digest("hex"),
    },
    storageLocation: "s3://pilo-secure-cutover/sqltoerd/2026-07-15/",
    retention: {
      deleteAfter: "2026-07-22T09:00:00.000Z",
    },
  };

  await assert.doesNotReject(
    validateSqlErdOperationsV1CutoverManifest({
      artifactPath,
      manifest,
    }),
  );

  await assert.rejects(
    validateSqlErdOperationsV1CutoverManifest({
      artifactPath,
      manifest: {
        ...manifest,
        artifact: {
          ...manifest.artifact,
          sha256: "0".repeat(64),
        },
      },
    }),
    /checksum/i,
  );

  await assert.rejects(
    validateSqlErdOperationsV1CutoverManifest({
      artifactPath,
      manifest: {
        ...manifest,
        scope: {
          ...manifest.scope,
          activeSessionPredicate: "deleted_at IS NULL",
        },
      },
    }),
    /snapshot session predicate/i,
  );

  await assert.rejects(
    validateSqlErdOperationsV1CutoverManifest({
      artifactPath,
      manifest: {
        ...manifest,
        retention: {
          deleteAfter: "2026-07-23T09:00:00.000Z",
        },
      },
    }),
    /seven days/i,
  );

  await assert.rejects(
    validateSqlErdOperationsV1CutoverManifest({
      artifactPath,
      manifest: {
        ...manifest,
        scope: {
          ...manifest.scope,
          sessionIds: [...sessionIds].reverse(),
        },
      },
    }),
    /sorted/,
  );
} finally {
  await rm(tempDirectory, { force: true, recursive: true });
}

console.log(`${path.basename(fileURLToPath(import.meta.url))} passed`);
