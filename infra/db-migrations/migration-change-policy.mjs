import { createHash } from "node:crypto";

const sha256Pattern = /^[a-f0-9]{64}$/;
const approvedRepair = {
  path: "db/migrations/104_create_github_sync_manual_request_admission.sql",
  baseSha256: "f7db8d3d356918b67e0c7d6dbab39b7fe4825f70658f0f172ea1408f40cacd1f",
  headSha256: "d1be506e0772045d31766d882a8b9c3d09b562c3bc437f6c0d4a63cfde82a116",
  issue: 1637,
};
const approvedRepairFields = Object.keys(approvedRepair);

function approvedRepairPolicyError(path) {
  return new Error(`Existing migrations are immutable. Approved repair policy is invalid: ${path}`);
}

function isExactApprovedRepair(repair) {
  return (
    repair !== null &&
    typeof repair === "object" &&
    !Array.isArray(repair) &&
    Object.keys(repair).length === approvedRepairFields.length &&
    approvedRepairFields.every(
      (field) => Object.hasOwn(repair, field) && repair[field] === approvedRepair[field],
    )
  );
}

function sha256(contents, path, label) {
  if (!Buffer.isBuffer(contents)) {
    throw new Error(`Existing migrations are immutable. ${path} ${label} contents must be raw Buffer bytes.`);
  }

  return createHash("sha256").update(contents).digest("hex");
}

export function verifyExistingMigrationRepair({
  status,
  path,
  baseContents,
  headContents,
  approvedRepairs,
}) {
  if (status !== "M") {
    throw new Error(`Existing migrations are immutable. ${status} change is not allowed: ${path}`);
  }

  if (
    !Array.isArray(approvedRepairs) ||
    approvedRepairs.length !== 1 ||
    !isExactApprovedRepair(approvedRepairs[0])
  ) {
    throw approvedRepairPolicyError(path);
  }

  const { baseSha256, headSha256 } = approvedRepairs[0];
  if (path !== approvedRepair.path || !sha256Pattern.test(baseSha256) || !sha256Pattern.test(headSha256)) {
    throw new Error(`Existing migrations are immutable. M change is not approved: ${path}`);
  }

  if (sha256(baseContents, path, "base") !== baseSha256) {
    throw new Error(`Existing migrations are immutable. Base SHA-256 does not match: ${path}`);
  }

  if (sha256(headContents, path, "head") !== headSha256) {
    throw new Error(`Existing migrations are immutable. Head SHA-256 does not match: ${path}`);
  }
}
