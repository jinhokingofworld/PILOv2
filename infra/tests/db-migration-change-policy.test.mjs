import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { verifyExistingMigrationRepair } from "../db-migrations/migration-change-policy.mjs";

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

const approvedRepairs = [
  {
    path: "db/migrations/104_create_github_sync_manual_request_admission.sql",
    baseSha256: "f7db8d3d356918b67e0c7d6dbab39b7fe4825f70658f0f172ea1408f40cacd1f",
    headSha256: "d1be506e0772045d31766d882a8b9c3d09b562c3bc437f6c0d4a63cfde82a116",
    issue: 1637,
  },
];

const approvedPath = approvedRepairs[0].path;
const approvedRepair = approvedRepairs[0];
const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const baseContents = execFileSync("git", ["show", `origin/main:${approvedPath}`], {
  cwd: repositoryRoot,
});
const headContents = await readFile(path.join(repositoryRoot, approvedPath));

assert.equal(
  sha256(baseContents),
  approvedRepair.baseSha256,
  "The temporary migration-104 recovery exception is stale. Remove the exception after the corrected checksum reaches main.",
);

function verifyWithManifest(manifest) {
  return verifyExistingMigrationRepair({
    status: "M",
    path: approvedPath,
    baseContents,
    headContents,
    approvedRepairs: manifest,
  });
}

assert.doesNotThrow(() =>
  verifyExistingMigrationRepair({
    status: "M",
    path: approvedPath,
    baseContents,
    headContents,
    approvedRepairs,
  }),
);

assert.throws(
  () =>
    verifyExistingMigrationRepair({
      status: "M",
      path: approvedPath,
      baseContents: Buffer.from("wrong-old"),
      headContents,
      approvedRepairs,
    }),
  /base SHA-256/i,
);

assert.throws(
  () =>
    verifyExistingMigrationRepair({
      status: "M",
      path: approvedPath,
      baseContents,
      headContents: Buffer.from("wrong-new"),
      approvedRepairs,
    }),
  /head SHA-256/i,
);

for (const status of ["D", "R100"]) {
  assert.throws(
    () =>
      verifyExistingMigrationRepair({
        status,
        path: approvedPath,
        baseContents,
        headContents,
        approvedRepairs,
      }),
    /immutable/i,
  );
}

assert.throws(
  () =>
    verifyExistingMigrationRepair({
      status: "M",
      path: "db/migrations/105_other.sql",
      baseContents,
      headContents,
      approvedRepairs,
    }),
  /immutable/i,
);

assert.throws(
  () =>
    verifyExistingMigrationRepair({
      status: "M",
      path: approvedPath,
      baseContents: headContents,
      headContents: Buffer.from("later"),
      approvedRepairs,
    }),
  /base SHA-256/i,
);

assert.throws(
  () =>
    verifyWithManifest([
      ...approvedRepairs,
      { ...approvedRepair, path: "db/migrations/105_other.sql" },
    ]),
  /approved.*repair.*policy/i,
);

assert.throws(
  () => verifyWithManifest([{ ...approvedRepair, path: "db/migrations/105_other.sql" }]),
  /approved.*repair.*policy/i,
);

assert.throws(
  () => verifyWithManifest([{ ...approvedRepair, issue: 9999 }]),
  /approved.*repair.*policy/i,
);

assert.throws(
  () =>
    verifyWithManifest([
      { ...approvedRepair, headSha256: sha256(Buffer.from("replacement-head")) },
    ]),
  /approved.*repair.*policy/i,
);

assert.throws(
  () => verifyWithManifest([{ ...approvedRepair, extra: true }]),
  /approved.*repair.*policy/i,
);

assert.throws(
  () => verifyWithManifest([{ path: approvedPath }]),
  /approved.*repair.*policy/i,
);

for (const malformedManifest of [null, {}, [null], ["repair"]]) {
  assert.throws(
    () => verifyWithManifest(malformedManifest),
    /approved.*repair.*policy/i,
  );
}

console.log("DB migration repair policy is verified.");
