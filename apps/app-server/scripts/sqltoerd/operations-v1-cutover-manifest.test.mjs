import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  decryptSqlErdOperationsV1CutoverArtifactWithAge,
  summarizeSqlErdOperationsV1CutoverRecovery,
  validateSqlErdOperationsV1CutoverManifestMetadata as validateManifestMetadataAtTime,
  verifySqlErdOperationsV1CutoverRecovery as verifyRecoveryAtTime,
} from "./operations-v1-cutover-manifest.mjs";

const tempDirectory = await mkdtemp(
  path.join(os.tmpdir(), "pilo-sqltoerd-cutover-")
);
const artifactPath = path.join(tempDirectory, "snapshot-sessions.sql.age");
const deleteSqlPath = fileURLToPath(
  new URL(
    "../../../../db/operations/sqltoerd-operations-v1-delete-snapshot-sessions.sql",
    import.meta.url
  )
);
const restoreSqlPath = fileURLToPath(
  new URL(
    "../../../../db/operations/sqltoerd-operations-v1-restore-snapshot-sessions.sql",
    import.meta.url
  )
);
const createdAt = "2026-07-15T09:00:00.000Z";
const validationNow = new Date(createdAt);
const sessionIds = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
];
const artifact = "age-encryption.org/v1\n-> X25519 test-recipient\n--- test";
const manifest = {
  version: 1,
  createdAt,
  scope: {
    activeSessionPredicate:
      "write_protocol = 'snapshot' AND deleted_at IS NULL",
    rowCount: sessionIds.length,
    sessionIds,
    sessionVersions: sessionIds.map((sessionId) => ({
      revision: 1,
      sessionId,
      updatedAt: createdAt,
    })),
  },
  artifact: {
    fileName: path.basename(artifactPath),
    encryption: "age",
    exportFormat: "sql_erd_sessions_ndjson_v1",
    sha256: createHash("sha256").update(artifact).digest("hex"),
  },
  storageLocation: "s3://pilo-secure-cutover/sqltoerd/2026-07-15/",
  retention: {
    deleteAfter: "2026-07-23T09:00:00.000Z",
  },
};

function validateSqlErdOperationsV1CutoverManifestMetadata(options) {
  return validateManifestMetadataAtTime({ ...options, now: validationNow });
}

function verifySqlErdOperationsV1CutoverRecovery(options) {
  return verifyRecoveryAtTime({ ...options, now: validationNow });
}

function createRecoverableSessionRow(id, overrides = {}) {
  return {
    created_at: "2026-07-01T00:00:00.000Z",
    created_by: "33333333-3333-4333-8333-333333333333",
    deleted_at: null,
    dialect: "postgresql",
    id,
    latest_op_seq: 0,
    layout_json: { tableLayouts: [], viewport: { x: 0, y: 0, zoom: 1 } },
    model_json: { relations: [], tables: [], version: 1 },
    relation_count: 0,
    revision: 1,
    settings_json: {},
    source_format: "sql",
    source_text: "CREATE TABLE example (id UUID PRIMARY KEY);",
    table_count: 1,
    title: "Recoverable ERD",
    updated_at: "2026-07-15T09:00:00.000Z",
    updated_by: "33333333-3333-4333-8333-333333333333",
    workspace_id: "44444444-4444-4444-8444-444444444444",
    write_protocol: "snapshot",
    ...overrides,
  };
}

try {
  await writeFile(artifactPath, artifact, "utf8");
  const deleteSql = await readFile(deleteSqlPath, "utf8");
  const restoreSql = await readFile(restoreSqlPath, "utf8");
  assert.match(deleteSql, /LOCK TABLE public\.sql_erd_sessions IN SHARE ROW EXCLUSIVE MODE/);
  assert.match(deleteSql, /expected_session_versions JSONB/);
  assert.match(deleteSql, /NOT isfinite\(expected_delete_after\)/);
  assert.match(deleteSql, /expected_delete_after < clock_timestamp\(\) \+ INTERVAL '7 days'/);
  assert.match(deleteSql, /expected\.revision IS DISTINCT FROM current_snapshot\.revision/);
  assert.match(deleteSql, /expected\.updated_at IS DISTINCT FROM current_snapshot\.updated_at/);
  assert.match(restoreSql, /\\set ON_ERROR_STOP on/);
  assert.match(
    restoreSql,
    /DISABLE TRIGGER trg_sql_erd_sessions_capture_creation_audit/
  );
  assert.match(
    restoreSql,
    /ENABLE TRIGGER trg_sql_erd_sessions_capture_creation_audit/
  );
  assert.match(restoreSql, /ON CONFLICT \(session_id\) DO NOTHING/);
  assert.match(
    restoreSql,
    /Existing SQLtoERD creation audit metadata conflicts with the restore/
  );
  assert.doesNotMatch(restoreSql, /DISABLE TRIGGER (?:ALL|USER)/);

  const safeSummary = summarizeSqlErdOperationsV1CutoverRecovery({
    manifest,
    result: {
      deleteAfter: manifest.retention.deleteAfter,
      recoveredSessionCount: sessionIds.length,
      recoveredSessionIds: sessionIds,
      sessionIds,
    },
  });
  assert.deepEqual(Object.keys(safeSummary).sort(), [
    "artifactSha256",
    "deleteAfter",
    "recoveredSessionCount",
    "recoveryVerified",
  ]);
  assert.doesNotMatch(JSON.stringify(safeSummary), new RegExp(sessionIds[0]));

  let ageInvocation;
  await decryptSqlErdOperationsV1CutoverArtifactWithAge({
    artifactPath,
    identityPath: "operator-identity.txt",
    outputPath: path.join(tempDirectory, "decrypted.ndjson"),
    runCommand: async (...argumentsList) => {
      ageInvocation = argumentsList;
    },
  });
  assert.deepEqual(ageInvocation, [
    "age",
    [
      "--decrypt",
      "--identity",
      "operator-identity.txt",
      "--output",
      path.join(tempDirectory, "decrypted.ndjson"),
      artifactPath,
    ],
    { maxBuffer: 1024 * 1024, windowsHide: true },
  ]);
  await assert.rejects(
    decryptSqlErdOperationsV1CutoverArtifactWithAge({
      artifactPath,
      identityPath: "wrong-identity.txt",
      outputPath: path.join(tempDirectory, "decrypted.ndjson"),
      runCommand: async () => {
        throw new Error("no matching keys");
      },
    }),
    /age decryption failed/
  );

  let plaintextPath;
  await assert.doesNotReject(
    verifySqlErdOperationsV1CutoverRecovery({
      artifactPath,
      manifest,
      identityPath: "operator-identity.txt",
      decryptToPath: async ({ outputPath }) => {
        plaintextPath = outputPath;
        await writeFile(
          outputPath,
          `${sessionIds
            .map((id) => JSON.stringify(createRecoverableSessionRow(id)))
            .join("\n")}\n`,
          "utf8"
        );
      },
    })
  );
  await assert.rejects(readFile(plaintextPath, "utf8"), /ENOENT/);

  await assert.rejects(
    verifySqlErdOperationsV1CutoverRecovery({
      artifactPath,
      manifest,
      decryptToPath: async ({ outputPath }) => {
        await writeFile(
          outputPath,
          `${sessionIds
            .map((id) =>
              JSON.stringify({
                deleted_at: null,
                id,
                write_protocol: "snapshot",
              })
            )
            .join("\n")}\n`,
          "utf8"
        );
      },
    }),
    /incomplete or invalid snapshot session row/
  );

  await assert.rejects(
    verifySqlErdOperationsV1CutoverRecovery({
      artifactPath,
      manifest,
      decryptToPath: async ({ outputPath }) => {
        await writeFile(
          outputPath,
          `${sessionIds
            .map((id, index) =>
              JSON.stringify(
                createRecoverableSessionRow(id, { revision: index === 0 ? 2 : 1 })
              )
            )
            .join("\n")}\n`,
          "utf8"
        );
      },
    }),
    /version does not match manifest/
  );

  await assert.doesNotReject(
    verifySqlErdOperationsV1CutoverRecovery({
      artifactPath,
      manifest,
      decryptToPath: async ({ outputPath }) => {
        await writeFile(
          outputPath,
          `${sessionIds
            .map((id) =>
              JSON.stringify(createRecoverableSessionRow(id, { dialect: "sqlite" }))
            )
            .join("\n")}\n`,
          "utf8"
        );
      },
    })
  );

  await assert.rejects(
    verifySqlErdOperationsV1CutoverRecovery({
      artifactPath,
      manifest,
      decryptToPath: async ({ outputPath }) => {
        await writeFile(
          outputPath,
          `${JSON.stringify(createRecoverableSessionRow(sessionIds[0]))}\n`,
          "utf8"
        );
      },
    }),
    /do not match manifest session IDs/i
  );

  await assert.rejects(
    verifySqlErdOperationsV1CutoverRecovery({
      artifactPath,
      manifest,
      decryptToPath: async ({ outputPath }) => {
        const plaintext = Buffer.from(
          `${sessionIds
            .map((id) => JSON.stringify(createRecoverableSessionRow(id)))
            .join("\n")}\n`,
          "utf8"
        );
        const titleOffset = plaintext.indexOf(Buffer.from("Recoverable ERD"));
        plaintext[titleOffset] = 0xc3;
        await writeFile(outputPath, plaintext);
      }
    }),
    /valid UTF-8/i
  );

  await assert.rejects(
    verifySqlErdOperationsV1CutoverRecovery({
      artifactPath,
      manifest,
      decryptToPath: async () => {
        throw new Error("age command failed");
      },
    }),
    /age command failed/
  );

  const plainArtifact = "plain snapshot export";
  await writeFile(artifactPath, plainArtifact, "utf8");
  await assert.rejects(
    validateSqlErdOperationsV1CutoverManifestMetadata({
      artifactPath,
      manifest: {
        ...manifest,
        artifact: {
          ...manifest.artifact,
          sha256: createHash("sha256").update(plainArtifact).digest("hex"),
        },
      },
    }),
    /age-encrypted/
  );
  await writeFile(artifactPath, artifact, "utf8");
  await assert.rejects(
    validateSqlErdOperationsV1CutoverManifestMetadata({
      artifactPath,
      manifest: {
        ...manifest,
        artifact: { ...manifest.artifact, sha256: "0".repeat(64) },
      },
    }),
    /checksum/i
  );

  await assert.rejects(
    validateSqlErdOperationsV1CutoverManifestMetadata({
      artifactPath,
      manifest: {
        ...manifest,
        artifact: { ...manifest.artifact, exportFormat: "csv" },
      },
    }),
    /metadata/i
  );
  await assert.rejects(
    validateSqlErdOperationsV1CutoverManifestMetadata({
      artifactPath,
      manifest: {
        ...manifest,
        scope: {
          ...manifest.scope,
          activeSessionPredicate: "deleted_at IS NULL",
        },
      },
    }),
    /snapshot session predicate/i
  );
  await assert.rejects(
    validateSqlErdOperationsV1CutoverManifestMetadata({
      artifactPath,
      manifest: {
        ...manifest,
        retention: { deleteAfter: "2026-07-21T09:00:00.000Z" },
      },
    }),
    /seven days/i
  );
  await assert.rejects(
    validateSqlErdOperationsV1CutoverManifestMetadata({
      artifactPath,
      manifest: {
        ...manifest,
        scope: { ...manifest.scope, sessionIds: [...sessionIds].reverse() },
      },
    }),
    /sorted/
  );
  await assert.rejects(
    validateSqlErdOperationsV1CutoverManifestMetadata({
      artifactPath,
      manifest: {
        ...manifest,
        scope: {
          ...manifest.scope,
          sessionIds: [
            "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
          ],
        },
      },
    }),
    /unique/
  );
  await assert.rejects(
    validateSqlErdOperationsV1CutoverManifestMetadata({
      artifactPath,
      manifest: {
        ...manifest,
        storageLocation: "file:///operator-laptop/snapshot-sessions.ndjson.age",
      },
    }),
    /restricted storage/
  );
  for (const storageLocation of [
    "s3://access:secret@pilo-secure-cutover/sqltoerd/",
    "vault://token@secure-vault/sqltoerd/",
    "s3://pilo-secure-cutover/sqltoerd/?signature=secret",
    "vault://secure-vault/sqltoerd/#fragment",
  ]) {
    await assert.rejects(
      validateSqlErdOperationsV1CutoverManifestMetadata({
        artifactPath,
        manifest: { ...manifest, storageLocation },
      }),
      /restricted storage/
    );
  }
} finally {
  await rm(tempDirectory, { force: true, recursive: true });
}

console.log(`${path.basename(fileURLToPath(import.meta.url))} passed`);
