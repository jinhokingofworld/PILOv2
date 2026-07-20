import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [variables, devMain, publisherPolicy] = await Promise.all([
  readFile(new URL("../envs/dev/variables.tf", import.meta.url), "utf8"),
  readFile(new URL("../envs/dev/main.tf", import.meta.url), "utf8"),
  readFile(new URL("../modules/iam/main.tf", import.meta.url), "utf8"),
]);

for (const [variableName, environmentName, defaultValue] of [
  ["github_manual_sync_user_limit", "GITHUB_MANUAL_SYNC_USER_LIMIT", "5"],
  ["github_manual_sync_workspace_limit", "GITHUB_MANUAL_SYNC_WORKSPACE_LIMIT", "10"],
  ["github_manual_sync_rate_window_seconds", "GITHUB_MANUAL_SYNC_RATE_WINDOW_SECONDS", "600"],
  ["github_manual_sync_cooldown_seconds", "GITHUB_MANUAL_SYNC_COOLDOWN_SECONDS", "30"],
  ["github_manual_sync_max_queued_jobs", "GITHUB_MANUAL_SYNC_MAX_QUEUED_JOBS", "100"],
]) {
  assert.match(
    variables,
    new RegExp(`variable\\s+"${variableName}"\\s*\\{[\\s\\S]*?type\\s*=\\s*number[\\s\\S]*?default\\s*=\\s*${defaultValue}[\\s\\S]*?validation\\s*\\{[\\s\\S]*?condition\\s*=\\s*var\\.${variableName}\\s*>\\s*0`, "s"),
    `${variableName} must be a positive number with default ${defaultValue}`,
  );
  assert.match(
    devMain,
    new RegExp(`app-server[\\s\\S]*?environment\\s*=\\s*\\{[\\s\\S]*?${environmentName}\\s*=\\s*tostring\\(var\\.${variableName}\\)`, "s"),
    `${environmentName} must be injected only into the App Server task`,
  );
}

const publisherPolicyBlock = publisherPolicy.match(
  /resource "aws_iam_role_policy" "github_actions_db_migration_publisher" \{[\s\S]*?\n\}/,
)?.[0];
assert.ok(publisherPolicyBlock, "DB migration publisher policy must exist");
assert.match(publisherPolicyBlock, /ecr:GetAuthorizationToken/);
assert.match(publisherPolicyBlock, /ecr:PutImage/);
assert.doesNotMatch(publisherPolicyBlock, /ecs:RunTask/i);
assert.doesNotMatch(publisherPolicyBlock, /\brds:/i);
assert.doesNotMatch(publisherPolicyBlock, /secretsmanager:/i);

console.log("GitHub manual sync admission App Server configuration is verified.");
