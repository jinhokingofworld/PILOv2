import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  GithubAppClient,
  GithubSourceSnapshotNotFoundError,
} = require("../../dist/modules/github-integration/github-app.client.js");
const {
  parseGithubSourceWebhookContext,
} = require("../../dist/modules/github-integration/github-source-webhook-context.js");
const {
  GithubSourceWebhookReconcileService,
} = require("../../dist/modules/github-integration/github-source-webhook-reconcile.service.js");
const {
  GithubWebhookDeliveryDispatcherService,
} = require("../../dist/modules/github-integration/github-webhook-delivery-dispatcher.service.js");
const {
  GithubWebhookService,
} = require("../../dist/modules/github-integration/github-webhook.service.js");

const workspaceId = "11111111-1111-4111-8111-111111111111";
const repositoryId = "22222222-2222-4222-8222-222222222222";
const issueId = "33333333-3333-4333-8333-333333333333";
const pullRequestId = "44444444-4444-4444-8444-444444444444";
const updatedAt = "2026-07-16T00:00:00.000Z";
const schema = await readFile(
  new URL("../../../../db/migrations/001_initial_schema.sql", import.meta.url),
  "utf8",
);
const projectItemTable = schema.match(
  /CREATE TABLE github_project_v2_items\s*\(([\s\S]*?)\n\);/i,
)?.[1];
assert.ok(projectItemTable, "github_project_v2_items schema must exist");
assert.match(projectItemTable, /\bissue_id\b/i);
assert.doesNotMatch(projectItemTable, /\bcontent_issue_id\b/i);

function webhookBody(source, overrides = {}) {
  return {
    action: "edited",
    installation: { id: 12 },
    repository: { id: 34 },
    [source]: { number: 56 },
    ...overrides,
  };
}

assert.deepEqual(parseGithubSourceWebhookContext("issues", webhookBody("issue")), {
  action: "edited",
  contentNumber: 56,
  githubInstallationId: 12,
  githubRepositoryId: 34,
  kind: "issue",
});
assert.deepEqual(
  parseGithubSourceWebhookContext(
    "issue_comment",
    webhookBody("issue", { issue: { number: 56, pull_request: { url: "https://api.github.test/pulls/56" } } }),
  ),
  {
    action: "edited",
    contentNumber: 56,
    githubInstallationId: 12,
    githubRepositoryId: 34,
    kind: "pull_request",
  },
);
assert.equal(parseGithubSourceWebhookContext("issue_comment", webhookBody("issue")), null);
assert.equal(parseGithubSourceWebhookContext("repository", webhookBody("issue")), null);

{
  const webhookSecret = "source-webhook-secret";
  let insertedValues = null;
  const enqueued = [];
  const database = {
    async queryOne(text, values = []) {
      if (/FROM github_webhook_deliveries/i.test(text) && !/INSERT INTO/i.test(text)) {
        return null;
      }
      if (/INSERT INTO github_webhook_deliveries/i.test(text)) {
        insertedValues = values;
        return {
          delivery_id: values[0],
          event_name: values[1],
          status: values[2],
          received_at: updatedAt,
          processed_at: null,
          error_message: values[7],
          action: values[3],
          github_installation_id: values[4],
          project_v2_node_id: values[5],
          project_item_node_id: values[6],
        };
      }
      throw new Error(`Unexpected webhook query: ${text}`);
    },
    async execute() { return { rowCount: 1 }; },
  };
  const service = new GithubWebhookService(
    database,
    { getGithubWebhookConfig: () => ({ webhookSecret }) },
    { enqueueWebhookDelivery: async (deliveryId) => enqueued.push(deliveryId) },
  );
  const body = webhookBody("pull_request");
  const rawBody = Buffer.from(JSON.stringify(body));
  const result = await service.receiveGithubWebhook({
    body,
    deliveryId: "source-receiver-delivery",
    eventName: "pull_request",
    rawBody,
    signature256: `sha256=${createHmac("sha256", webhookSecret).update(rawBody).digest("hex")}`,
  });
  assert.equal(result.status, "received");
  assert.deepEqual(insertedValues.slice(3, 7), ["edited", 12, "34", "56"]);
  assert.deepEqual(enqueued, ["source-receiver-delivery"]);
}

class SourceDatabase {
  constructor(eventName, { activeReceivedLease = false } = {}) {
    this.activeReceivedLease = activeReceivedLease;
    this.boardLookupSql = null;
    this.claimSql = null;
    this.committed = false;
    this.events = [];
    this.eventName = eventName;
    this.issueValues = null;
    this.lockKey = null;
    this.pullRequestSql = null;
    this.pullRequestValues = null;
    this.processed = 0;
    this.retried = 0;
  }

  async queryOne(text, values = []) {
    if (/UPDATE github_webhook_deliveries[\s\S]*RETURNING/i.test(text)) {
      this.claimSql = text;
      if (this.activeReceivedLease) {
        return null;
      }
      return {
        content_number: "56",
        delivery_id: values[0],
        event_name: this.eventName,
        github_installation_id: 12,
        github_repository_id: "34",
      };
    }
    if (/INSERT INTO github_issues/i.test(text)) {
      this.events.push("upsert");
      this.issueValues = values;
      return { id: issueId, updated_at: updatedAt };
    }
    if (/INSERT INTO github_pull_requests/i.test(text)) {
      this.events.push("upsert");
      this.pullRequestSql = text;
      this.pullRequestValues = values;
      return { id: pullRequestId, updated_at: updatedAt };
    }
    throw new Error(`Unexpected queryOne: ${text}`);
  }

  async query(text, values = []) {
    if (/FROM github_installations AS installation/i.test(text)) {
      this.events.push("targets");
      assert.deepEqual(values, [12, "34"]);
      return [{
        github_installation_id: 12,
        repository_id: repositoryId,
        repository_name: "repo",
        repository_owner_login: "pilo",
        workspace_id: workspaceId,
      }];
    }
    if (/FROM boards AS board/i.test(text)) {
      this.boardLookupSql = text;
      return [];
    }
    throw new Error(`Unexpected query: ${text}`);
  }

  async execute(text, values = []) {
    if (/pg_advisory_xact_lock/i.test(text)) {
      this.events.push("lock");
      this.lockKey = values[0];
      assert.match(text, /hashtextextended\(\$1::text, 0\)/);
      return { rowCount: 1 };
    }
    if (/status='processed'/i.test(text)) {
      this.events.push("mark-processed");
      this.processed += 1;
      return { rowCount: 1 };
    }
    if (/GitHub source webhook reconcile failed/i.test(text)) {
      this.retried += 1;
      return { rowCount: 1 };
    }
    throw new Error(`Unexpected execute: ${text}`);
  }

  async transaction(callback) {
    this.events.push("transaction:start");
    try {
      const result = await callback(this);
      this.committed = true;
      this.events.push("transaction:commit");
      return result;
    } catch (error) {
      this.events.push("transaction:rollback");
      throw error;
    }
  }
}

function issueSnapshot() {
  return {
    id: 560,
    node_id: "I_node",
    number: 56,
    title: "Webhook issue title",
    body: "Webhook issue body",
    state: "closed",
    state_reason: "completed",
    user: { login: "octocat", avatar_url: "https://avatars.test/octocat" },
    html_url: "https://github.test/pilo/repo/issues/56",
    labels: [{ name: "bug" }],
    assignees: [{ login: "hubot" }],
    milestone: { title: "M1" },
    created_at: "2026-07-15T00:00:00.000Z",
    updated_at: updatedAt,
    closed_at: updatedAt,
  };
}

function pullRequestSnapshot() {
  return {
    id: 561,
    node_id: "PR_node",
    number: 56,
    title: "Webhook PR title",
    body: "Webhook PR body",
    state: "closed",
    draft: true,
    mergeable: false,
    user: { login: "octocat", avatar_url: "https://avatars.test/octocat" },
    head: { ref: "feature", sha: "new-head-sha" },
    base: { ref: "dev", sha: "base-sha" },
    changed_files: 7,
    additions: 80,
    deletions: 9,
    commits: 4,
    comments: 3,
    review_comments: 2,
    html_url: "https://github.test/pilo/repo/pull/56",
    created_at: "2026-07-15T00:00:00.000Z",
    updated_at: updatedAt,
    closed_at: updatedAt,
    merged_at: updatedAt,
  };
}

function createService({ database, githubAppClient, published, publisherFails = false }) {
  return new GithubSourceWebhookReconcileService(
    database,
    { getGithubAppConfig: () => ({ appId: "1", privateKey: "key" }) },
    githubAppClient,
    {
      async publishInvalidation(payload) {
        assert.equal(database.committed, true, "source publish must follow commit");
        database.events.push("publish");
        published.push(payload);
        if (publisherFails) throw new Error("Redis unavailable");
      },
    },
    { publishInvalidation: async () => undefined },
  );
}

{
  const database = new SourceDatabase("issues");
  const published = [];
  const service = createService({
    database,
    githubAppClient: {
      getRepositoryIssue: async () => {
        database.events.push("rest-fetch");
        return issueSnapshot();
      },
    },
    published,
    publisherFails: true,
  });
  const originalConsoleError = console.error;
  const loggedErrors = [];
  console.error = (...args) => loggedErrors.push(args);
  try {
    assert.equal(await service.processDelivery("issue-delivery"), "terminal");
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(loggedErrors.length, 1);
  assert.equal(database.processed, 1);
  assert.equal(database.retried, 0);
  assert.equal(database.lockKey, "github-source-webhook:12:34:issue:56");
  assert.deepEqual(database.events.slice(0, 7), [
    "transaction:start",
    "lock",
    "targets",
    "rest-fetch",
    "upsert",
    "mark-processed",
    "transaction:commit",
  ]);
  assert.equal(database.events.at(-1), "publish");
  assert.deepEqual(JSON.parse(database.issueValues[12]), [{ name: "bug" }]);
  assert.deepEqual(JSON.parse(database.issueValues[13]), [{ login: "hubot" }]);
  assert.deepEqual(JSON.parse(database.issueValues[14]), { title: "M1" });
  assert.equal(JSON.parse(database.issueValues[18]).state, "closed");
  assert.match(database.boardLookupSql, /item\.issue_id=\$3/);
  assert.doesNotMatch(database.boardLookupSql, /content_issue_id/);
  assert.match(
    database.claimSql,
    /status='received' AND \(lease_expires_at IS NULL OR lease_expires_at < now\(\)\)/,
  );
  assert.deepEqual(published[0], {
    repositoryId,
    sourceId: issueId,
    sourceNumber: 56,
    sourceType: "issue",
    updatedAt,
    workspaceId,
  });
}

{
  const database = new SourceDatabase("pull_request");
  const published = [];
  const service = createService({
    database,
    githubAppClient: { getPullRequestWebhookSnapshot: async () => pullRequestSnapshot() },
    published,
  });
  assert.equal(await service.processDelivery("pr-delivery"), "terminal");
  assert.equal(database.processed, 1);
  assert.deepEqual(database.pullRequestValues.slice(9, 17), [
    "feature", "dev", 7, 80, 9, 4, 3, 2,
  ]);
  assert.match(
    database.pullRequestSql,
    /changed_files_count, additions, deletions,[\s\S]*commits_count, comments_count, review_comments_count/,
  );
  assert.match(database.pullRequestSql, /changed_files_count=EXCLUDED\.changed_files_count/);
  assert.match(database.pullRequestSql, /additions=EXCLUDED\.additions/);
  assert.match(database.pullRequestSql, /deletions=EXCLUDED\.deletions/);
  assert.match(database.pullRequestSql, /commits_count=EXCLUDED\.commits_count/);
  assert.match(database.pullRequestSql, /comments_count=EXCLUDED\.comments_count/);
  assert.match(database.pullRequestSql, /review_comments_count=EXCLUDED\.review_comments_count/);
  const raw = JSON.parse(database.pullRequestValues[22]);
  assert.equal(raw.state, "closed");
  assert.equal(raw.draft, true);
  assert.equal(raw.mergeable, false);
  assert.equal(raw.merged_at, updatedAt);
  assert.equal(raw.head.sha, "new-head-sha");
  assert.equal(raw.base.sha, "base-sha");
  assert.equal(published[0].sourceType, "pull_request");
  assert.equal(published[0].sourceId, pullRequestId);
}

{
  const database = new SourceDatabase("issues", { activeReceivedLease: true });
  let lookupCalls = 0;
  const service = createService({
    database,
    githubAppClient: {
      getRepositoryIssue: async () => {
        lookupCalls += 1;
        return issueSnapshot();
      },
    },
    published: [],
  });
  assert.equal(await service.processDelivery("cooldown-delivery"), "terminal");
  assert.equal(lookupCalls, 0, "an active retry cooldown cannot be reclaimed");
  assert.match(
    database.claimSql,
    /status='received' AND \(lease_expires_at IS NULL OR lease_expires_at < now\(\)\)/,
  );
}

{
  const client = new GithubAppClient();
  client.createInstallationAccessToken = async () => ({
    token: "installation-token",
    expiresAt: null,
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", {
    status: 404,
    headers: { "content-type": "application/json" },
  });
  const request = {
    appId: "1",
    installationId: 12,
    owner: "pilo",
    privateKey: "unused-by-test-double",
    pullNumber: 56,
    repo: "repo",
  };
  try {
    await assert.rejects(
      () => client.getPullRequest(request),
      (error) =>
        error?.getStatus?.() === 400 &&
        !(error instanceof GithubSourceSnapshotNotFoundError),
      "the existing PR lookup must preserve its ApiError 404 mapping",
    );
    await assert.rejects(
      () => client.getPullRequestWebhookSnapshot(request),
      (error) => error instanceof GithubSourceSnapshotNotFoundError,
      "only the webhook snapshot lookup opts into terminal source-not-found",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const database = new SourceDatabase("issues");
  const service = createService({
    database,
    githubAppClient: {
      getRepositoryIssue: async () => { throw new GithubSourceSnapshotNotFoundError(); },
    },
    published: [],
  });
  assert.equal(await service.processDelivery("missing-delivery"), "terminal");
  assert.equal(database.issueValues, null, "404 must retain the existing local cache");
  assert.equal(database.processed, 1);
  assert.equal(database.retried, 0);
}

{
  const calls = [];
  const database = {
    queryOne: async () => ({ event_name: "projects_v2_item" }),
  };
  const dispatcher = new GithubWebhookDeliveryDispatcherService(
    database,
    { processDelivery: async (id) => { calls.push(["project_v2", id]); return "terminal"; } },
    { processDelivery: async (id) => { calls.push(["source", id]); return "terminal"; } },
  );
  assert.equal(await dispatcher.processDelivery("pv2-delivery"), "terminal");
  assert.deepEqual(calls, [["project_v2", "pv2-delivery"]]);

  database.queryOne = async () => ({ event_name: "pull_request" });
  assert.equal(await dispatcher.processDelivery("pr-delivery"), "terminal");
  assert.deepEqual(calls.at(-1), ["source", "pr-delivery"]);
}

console.log("GitHub source webhook reconcile tests passed");
