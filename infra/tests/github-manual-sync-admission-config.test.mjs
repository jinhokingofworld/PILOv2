import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [variables, devMain, publisherPolicy] = await Promise.all([
  readFile(new URL("../envs/dev/variables.tf", import.meta.url), "utf8"),
  readFile(new URL("../envs/dev/main.tf", import.meta.url), "utf8"),
  readFile(new URL("../modules/iam/main.tf", import.meta.url), "utf8"),
]);

function extractDelimited(source, openingIndex, opening, closing, description) {
  assert.equal(source[openingIndex], opening, `${description} must start with ${opening}`);

  let depth = 0;
  let quote = false;
  let escaped = false;

  for (let index = openingIndex; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        quote = false;
      }
      continue;
    }

    if (character === '"') {
      quote = true;
    } else if (character === opening) {
      depth += 1;
    } else if (character === closing) {
      depth -= 1;
      if (depth === 0) return source.slice(openingIndex, index + 1);
    }
  }

  assert.fail(`${description} is not balanced`);
}

function extractBlock(source, header, description) {
  const headerIndex = source.indexOf(header);
  assert.notEqual(headerIndex, -1, `${description} must exist`);
  const openingIndex = source.indexOf("{", headerIndex + header.length);
  assert.notEqual(openingIndex, -1, `${description} must open`);
  return extractDelimited(source, openingIndex, "{", "}", description);
}

function extractTopLevelBlocks(source) {
  const blocks = [];
  let depth = 0;
  let quote = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        quote = false;
      }
      continue;
    }

    if (character === '"') {
      quote = true;
      continue;
    }
    if (character === "{") {
      depth += 1;
      continue;
    }
    if (character === "}") {
      depth -= 1;
      continue;
    }
    if (depth !== 0 || (!source.startsWith('module "', index) && !source.startsWith('resource "', index))) continue;

    const openingIndex = source.indexOf("{", index);
    assert.notEqual(openingIndex, -1, "top-level block must open");
    const block = extractDelimited(source, openingIndex, "{", "}", "top-level block");
    blocks.push({
      header: source.slice(index, openingIndex).trim(),
      body: block,
    });
    index = openingIndex + block.length - 1;
  }

  return blocks;
}

function extractMapObjectBlocks(map, description) {
  assert.equal(map[0], "{", `${description} must be an object`);
  const blocks = [];

  for (let index = 1; index < map.length - 1; index += 1) {
    if (!/[A-Za-z0-9_-]/.test(map[index])) continue;

    const nameStart = index;
    while (/[A-Za-z0-9_-]/.test(map[index])) index += 1;
    const name = map.slice(nameStart, index);
    while (/\s/.test(map[index])) index += 1;
    if (map[index] !== "=") continue;
    index += 1;
    while (/\s/.test(map[index])) index += 1;
    if (map[index] !== "{") continue;

    const body = extractDelimited(map, index, "{", "}", `${description} ${name}`);
    blocks.push({ name, body });
    index += body.length - 1;
  }

  return blocks;
}

function extractQuotedValues(source) {
  const values = [];
  let quote = false;
  let escaped = false;
  let value = "";

  for (const character of source) {
    if (!quote) {
      if (character === '"') {
        quote = true;
        value = "";
      }
      continue;
    }

    if (escaped) {
      value += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === '"') {
      values.push(value);
      quote = false;
    } else {
      value += character;
    }
  }

  assert.equal(quote, false, "quoted values must be terminated");
  return values;
}

function extractPolicyActions(policy) {
  const actions = [];
  let index = policy.indexOf("Action");

  while (index !== -1) {
    let cursor = index + "Action".length;
    while (/\s/.test(policy[cursor])) cursor += 1;
    assert.equal(policy[cursor], "=", "every Action field must be assigned");
    cursor += 1;
    while (/\s/.test(policy[cursor])) cursor += 1;
    assert.equal(policy[cursor], "[", "every Action field must be an explicit list");

    const actionList = extractDelimited(policy, cursor, "[", "]", "publisher policy Action list");
    actions.push(...extractQuotedValues(actionList));
    index = policy.indexOf("Action", cursor + actionList.length);
  }

  return actions;
}

function hasAssignment(source, name, value) {
  const nameIndex = source.indexOf(name);
  if (nameIndex === -1) return false;

  let cursor = nameIndex + name.length;
  while (/\s/.test(source[cursor])) cursor += 1;
  if (source[cursor] !== "=") return false;
  cursor += 1;
  while (/\s/.test(source[cursor])) cursor += 1;
  return source.startsWith(value, cursor);
}

const manualSyncSettings = [
  ["github_manual_sync_user_limit", "GITHUB_MANUAL_SYNC_USER_LIMIT", "5"],
  ["github_manual_sync_workspace_limit", "GITHUB_MANUAL_SYNC_WORKSPACE_LIMIT", "10"],
  ["github_manual_sync_rate_window_seconds", "GITHUB_MANUAL_SYNC_RATE_WINDOW_SECONDS", "600"],
  ["github_manual_sync_cooldown_seconds", "GITHUB_MANUAL_SYNC_COOLDOWN_SECONDS", "30"],
  ["github_manual_sync_max_queued_jobs", "GITHUB_MANUAL_SYNC_MAX_QUEUED_JOBS", "100"],
];

for (const [variableName, , defaultValue] of manualSyncSettings) {
  const variableBlock = extractBlock(variables, `variable "${variableName}"`, variableName);
  assert.ok(variableBlock.includes("type        = number"), `${variableName} must be a number`);
  assert.ok(variableBlock.includes(`default     = ${defaultValue}`), `${variableName} must default to ${defaultValue}`);

  const validationBlock = extractBlock(variableBlock, "validation", `${variableName} validation`);
  const value = `var.${variableName}`;
  assert.ok(validationBlock.includes(`${value} > 0`), `${variableName} must be positive`);
  assert.ok(validationBlock.includes(`floor(${value}) == ${value}`), `${variableName} must be an integer`);
  assert.ok(validationBlock.includes(`${value} <= 9007199254740991`), `${variableName} must not exceed JavaScript's safe integer maximum`);
}

const topLevelBlocks = extractTopLevelBlocks(devMain);
const ecsModule = topLevelBlocks.find(({ header }) => header === 'module "ecs"')?.body;
assert.ok(ecsModule, "ECS module must exist");
const services = extractBlock(ecsModule, "services =", "ECS services");
const serviceBlocks = extractMapObjectBlocks(services, "ECS service");
const appServer = serviceBlocks.find(({ name }) => name === "app-server")?.body;
assert.ok(appServer, "App Server service must exist");
const appServerEnvironment = extractBlock(appServer, "environment =", "App Server environment");

for (const [variableName, environmentName] of manualSyncSettings) {
  assert.ok(hasAssignment(appServerEnvironment, environmentName, `tostring(var.${variableName})`), `${environmentName} must be injected into the App Server environment`);
  for (const { header, body } of topLevelBlocks) {
    if (header !== 'module "ecs"') {
      assert.equal(body.includes(environmentName), false, `${environmentName} must not be injected into ${header}`);
    }
  }
  for (const { name, body } of serviceBlocks) {
    if (name !== "app-server") {
      assert.equal(body.includes(environmentName), false, `${environmentName} must not be injected into the ${name} ECS service`);
    }
  }
}

const publisherPolicyBlock = extractBlock(
  publisherPolicy,
  'resource "aws_iam_role_policy" "github_actions_db_migration_publisher"',
  "DB migration publisher policy",
);
const approvedEcrActions = [
  "ecr:BatchCheckLayerAvailability",
  "ecr:BatchGetImage",
  "ecr:CompleteLayerUpload",
  "ecr:GetAuthorizationToken",
  "ecr:GetDownloadUrlForLayer",
  "ecr:InitiateLayerUpload",
  "ecr:PutImage",
  "ecr:UploadLayerPart",
];
const actualActions = extractPolicyActions(publisherPolicyBlock);

assert.deepEqual([...actualActions].sort(), [...approvedEcrActions].sort(), "DB migration publisher policy must grant exactly the approved ECR actions");
assert.ok(actualActions.every((action) => action.startsWith("ecr:") && !action.includes("*")), "DB migration publisher policy must not grant wildcard or non-ECR actions");

console.log("GitHub manual sync admission App Server configuration is verified.");
