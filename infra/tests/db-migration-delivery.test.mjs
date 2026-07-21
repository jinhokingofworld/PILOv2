import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [workflow, runnerScript, iamModule, iamOutputs, devOutputs] =
  await Promise.all([
    readFile(
      new URL("../../.github/workflows/publish-db-migrations.yml", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../scripts/run-dev-db-migrations.ps1", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../modules/iam/main.tf", import.meta.url), "utf8"),
    readFile(new URL("../modules/iam/outputs.tf", import.meta.url), "utf8"),
    readFile(new URL("../envs/dev/outputs.tf", import.meta.url), "utf8"),
  ]);

assert.match(workflow, /push:\s*\n\s+branches: \["dev"\]/);
assert.match(workflow, /workflow_dispatch:/);
assert.match(
  workflow,
  /push:\s*\n\s+branches: \["dev"\]\s*\n\s+paths:\s*\n\s+- "db\/migrations\/\*\*"\s*\n\s+- "infra\/db-migrations\/\*\*"\s*\n\s+workflow_dispatch:\s*\n\s*\npermissions:/,
);
assert.doesNotMatch(workflow, /workflow_dispatch:\s*\n\s+-/);
assert.match(workflow, /db\/migrations\/\*\*/);
assert.match(workflow, /infra\/db-migrations\/\*\*/);
assert.match(workflow, /id-token: write/);
assert.match(workflow, /AWS_DB_MIGRATION_PUBLISH_ROLE_ARN/);
assert.match(workflow, /pilo-db-migrations/);
assert.match(workflow, /\$\{\{ github\.sha \}\}/);
assert.match(workflow, /node infra\/tests\/db-migration-change-policy\.test\.mjs/);
assert.match(workflow, /node infra\/tests\/db-migration-change\.test\.mjs/);
assert.match(workflow, /github\.ref == 'refs\/heads\/dev'/);

assert.match(runnerScript, /\[string\] \$ImageTag/);
assert.match(runnerScript, /ImageTag is required/);
assert.match(runnerScript, /"ecr", "describe-images"/);
assert.match(runnerScript, /imageDigest/);
assert.match(runnerScript, /register-task-definition/);
assert.match(runnerScript, /\$imageReference = "\$repositoryUri@\$imageDigest"/);
assert.match(runnerScript, /MIGRATION_SOURCE_REVISION/);

assert.match(iamModule, /github_actions_db_migration_publisher_assume_role/);
assert.match(iamModule, /refs\/heads\/dev/);
assert.match(iamModule, /github_actions_db_migration_publisher/);
assert.match(iamModule, /ecr:PutImage/);
assert.match(iamModule, /ecr:BatchGetImage/);
assert.match(iamModule, /ecr:GetDownloadUrlForLayer/);
assert.match(iamModule, /db_migration_publisher_repository_arn/);
assert.match(iamOutputs, /github_actions_db_migration_publisher_role_arn/);
assert.match(devOutputs, /db_migration_publisher_role_arn/);

console.log("DB migration publishing and immutable execution are verified.");
