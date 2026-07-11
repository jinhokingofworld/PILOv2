import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { GithubAppClient } = require("../../dist/modules/github-integration/github-app.client.js");
const { GithubSyncExecutorService } = require("../../dist/modules/github-integration/github-sync-executor.service.js");
const { GithubSyncJobService } = require("../../dist/modules/github-integration/github-sync-job.service.js");
const { GithubWebhookService } = require("../../dist/modules/github-integration/github-webhook.service.js");
const { GithubProjectV2WebhookReconcileService } = require("../../dist/modules/github-integration/github-project-v2-webhook-reconcile.service.js");

const webhookSecret = "test-webhook-secret";
const receivedAt = "2026-07-11T09:00:00.000Z";
const webhookEnqueuePendingMessage = "GitHub webhook enqueue is pending";
const selectedDeliveryId = "projects-v2-item-selected";
const unselectedDeliveryId = "projects-v2-item-unselected";
const invalidDeliveryId = "projects-v2-item-invalid";
const context = {
  action: "edited",
  githubInstallationId: 123,
  projectV2NodeId: "PVT_kwDOExample",
  projectItemNodeId: "PVTI_lADOExample"
};

class FakeDatabase {
  constructor({ selected, deliveries = [] }) {
    this.selected = selected;
    this.deliveries = new Map(deliveries.map((delivery) => [delivery.delivery_id, delivery]));
    this.queries = [];
  }

  async queryOne(text, values = []) {
    this.queries.push({ method: "queryOne", text, values });

    if (/FROM github_webhook_deliveries/i.test(text) && !/INSERT INTO/i.test(text)) {
      return this.deliveries.get(values[0]) ?? null;
    }

    if (/FROM github_installations/i.test(text)) {
      assert.match(text, /JOIN github_projects_v2/i);
      assert.match(text, /JOIN github_project_v2_selections/i);
      assert.match(text, /owner_type\s*=\s*'Organization'/i);
      assert.deepEqual(values, [context.githubInstallationId, context.projectV2NodeId]);
      return this.selected ? { id: "selected-project" } : null;
    }

    if (/INSERT INTO github_webhook_deliveries/i.test(text)) {
      const hasContext = values.length === 8;
      if (hasContext) {
        assert.match(text, /action/i);
        assert.match(text, /github_installation_id/i);
        assert.match(text, /project_v2_node_id/i);
        assert.match(text, /project_item_node_id/i);
      }

      const delivery = {
        delivery_id: values[0],
        event_name: values[1],
        status: values[2],
        received_at: receivedAt,
        processed_at: values[2] === "received" ? null : receivedAt,
        error_message: hasContext ? values[7] : values[3],
        context: hasContext
          ? {
              action: values[3],
              githubInstallationId: values[4],
              projectV2NodeId: values[5],
              projectItemNodeId: values[6]
            }
          : null
      };
      this.deliveries.set(delivery.delivery_id, delivery);
      return delivery;
    }

    throw new Error(`Unexpected query: ${text}`);
  }

  async execute(text, values = []) {
    this.queries.push({ method: "execute", text, values });
    const delivery = this.deliveries.get(values[0]);

    if (delivery && /status='received'/i.test(text)) {
      delivery.status = "received";
      delivery.processed_at = null;
      delivery.error_message = null;
    }

    return { rowCount: 1 };
  }
}

class ConcurrentFakeDatabase extends FakeDatabase {
  constructor() {
    super({ selected: true });
    this.deliveryLookups = 0;
    this.bothInitialLookups = new Promise((resolve) => {
      this.releaseInitialLookups = resolve;
    });
  }

  async queryOne(text, values = []) {
    this.queries.push({ method: "queryOne", text, values });

    if (/FROM github_webhook_deliveries/i.test(text) && !/INSERT INTO/i.test(text)) {
      const delivery = this.deliveries.get(values[0]) ?? null;
      this.deliveryLookups += 1;

      if (this.deliveryLookups <= 2) {
        if (this.deliveryLookups === 2) this.releaseInitialLookups();
        await this.bothInitialLookups;
      }

      return delivery;
    }

    if (/FROM github_installations/i.test(text)) {
      assert.match(text, /JOIN github_projects_v2/i);
      assert.match(text, /JOIN github_project_v2_selections/i);
      assert.deepEqual(values, [context.githubInstallationId, context.projectV2NodeId]);
      return { id: "selected-project" };
    }

    if (/INSERT INTO github_webhook_deliveries/i.test(text)) {
      const existing = this.deliveries.get(values[0]);
      if (existing) return null;

      const delivery = {
        delivery_id: values[0],
        event_name: values[1],
        status: values[2],
        received_at: receivedAt,
        processed_at: null,
        error_message: values[7],
        context: {
          action: values[3],
          githubInstallationId: values[4],
          projectV2NodeId: values[5],
          projectItemNodeId: values[6]
        }
      };
      this.deliveries.set(delivery.delivery_id, delivery);
      return delivery;
    }

    throw new Error(`Unexpected query: ${text}`);
  }
}

function sign(rawBody) {
  return `sha256=${createHmac("sha256", webhookSecret).update(rawBody).digest("hex")}`;
}

function payload(overrides = {}) {
  return {
    action: context.action,
    installation: { id: context.githubInstallationId },
    projects_v2_item: {
      node_id: context.projectItemNodeId,
      project_node_id: context.projectV2NodeId
    },
    ...overrides
  };
}

function createService(database, enqueuedDeliveryIds) {
  return new GithubWebhookService(
    database,
    { getGithubWebhookConfig: () => ({ webhookSecret }) },
    { enqueueWebhookDelivery: async (deliveryId) => enqueuedDeliveryIds.push(deliveryId) }
  );
}

async function receive(service, deliveryId, body) {
  const rawBody = Buffer.from(JSON.stringify(body));
  return service.receiveGithubWebhook({
    deliveryId,
    eventName: "projects_v2_item",
    signature256: sign(rawBody),
    rawBody,
    body
  });
}

function projectV2ItemNode() {
  return {
    __typename: "ProjectV2Item",
    id: context.projectItemNodeId,
    databaseId: 9001,
    type: "ISSUE",
    isArchived: false,
    createdAt: "2026-07-11T09:00:00.000Z",
    updatedAt: "2026-07-11T09:00:00.000Z",
    content: {
      __typename: "Issue",
      id: "I_kwDOExample",
      databaseId: 609,
      number: 24,
      title: "Targeted webhook reconcile",
      body: "Keep this cache fresh",
      state: "OPEN",
      stateReason: null,
      url: "https://github.com/example/repo/issues/24",
      author: {
        login: "octocat",
        avatarUrl: "https://avatars.example.test/octocat"
      },
      labels: { nodes: [] },
      assignees: { nodes: [] },
      milestone: null,
      createdAt: "2026-07-10T09:00:00.000Z",
      updatedAt: "2026-07-11T09:00:00.000Z",
      closedAt: null,
      repository: { id: "R_kgDOExample" }
    },
    fieldValues: {
      nodes: [],
      pageInfo: {
        hasNextPage: true,
        endCursor: "field-value-cursor-1"
      }
    }
  };
}

function laterPageFieldValue() {
  return {
    __typename: "ProjectV2ItemFieldTextValue",
    id: "PVTFV_later-page",
    text: "Persisted from the later page",
    createdAt: "2026-07-11T09:01:00.000Z",
    updatedAt: "2026-07-11T09:02:00.000Z",
    field: {
      id: "PVTF_later-page",
      name: "Implementation note",
      dataType: "TEXT"
    }
  };
}

function pullRequestWebhookItem() {
  return {
    item: {
      id: "PVTI_pull-request",
      databaseId: 9002,
      contentType: "PULL_REQUEST",
      contentNodeId: "PR_kwDOExample",
      isArchived: false,
      statusFieldNodeId: null,
      statusOptionId: null,
      statusName: null,
      position: null,
      createdAt: "2026-07-11T09:00:00.000Z",
      updatedAt: "2026-07-11T09:00:00.000Z",
      fieldValues: [],
      raw: {}
    },
    issue: null,
    pullRequest: {
      id: 701,
      node_id: "PR_kwDOExample",
      number: 25,
      title: "Targeted pull request reconcile",
      body: "Keep this PR cache fresh",
      user: { login: "octocat", avatar_url: "https://avatars.example.test/octocat" },
      head: { ref: "feature/webhook", sha: "abc", repo: null },
      base: { ref: "main", sha: "def" },
      changed_files: 1,
      additions: 2,
      deletions: 3,
      commits: 4,
      comments: 5,
      review_comments: 6,
      html_url: "https://github.com/example/repo/pull/25",
      created_at: "2026-07-10T09:00:00.000Z",
      updated_at: "2026-07-11T09:00:00.000Z",
      closed_at: null,
      merged_at: null,
      draft: false,
      mergeable: true,
      state: "open"
    },
    repositoryNodeId: "R_kgDOExample"
  };
}

class ReconcileFakeDatabase {
  constructor({ fieldValueNames = [] } = {}) {
    this.queries = [];
    this.fieldValueNames = [...fieldValueNames];
  }

  async queryOne(text, values = []) {
    this.queries.push({ method: "queryOne", text, values });

    if (/FROM github_repositories/i.test(text)) {
      assert.deepEqual(values, ["workspace-1", "R_kgDOExample"]);
      return { id: "repository-1" };
    }

    if (/INSERT INTO github_issues/i.test(text)) {
      assert.deepEqual(values.slice(0, 5), ["workspace-1", "repository-1", 609, "I_kwDOExample", 24]);
      return { id: "issue-1", created: false };
    }

    if (/FROM github_issues/i.test(text)) {
      assert.deepEqual(values, ["workspace-1", "I_kwDOExample"]);
      return { id: "issue-1", repository_id: "repository-1" };
    }

    if (/INSERT INTO github_pull_requests/i.test(text)) {
      assert.deepEqual(values.slice(0, 6), [
        "workspace-1",
        "repository-1",
        701,
        "PR_kwDOExample",
        25,
        "Targeted pull request reconcile"
      ]);
      return { id: "pull-request-1", created: false };
    }

    if (/FROM github_pull_requests/i.test(text)) {
      assert.deepEqual(values, ["workspace-1", "PR_kwDOExample"]);
      return { id: "pull-request-1", repository_id: "repository-1" };
    }

    if (/FROM github_project_v2_fields/i.test(text)) {
      assert.deepEqual(values, ["project-1", "PVTF_later-page"]);
      return { id: "field-1", created: false };
    }

    if (/INSERT INTO github_project_v2_items/i.test(text)) {
      const isPullRequest = values[4] === "PULL_REQUEST";
      assert.deepEqual(values.slice(0, 8), isPullRequest
        ? [
            "workspace-1",
            "project-1",
            "PVTI_pull-request",
            9002,
            "PULL_REQUEST",
            null,
            "pull-request-1",
            false
          ]
        : [
            "workspace-1",
            "project-1",
            context.projectItemNodeId,
            9001,
            "ISSUE",
            "issue-1",
            null,
            false
          ]
      );
      return { id: "project-item-1", created: false };
    }

    if (/hydrate_pilo_board_from_github/i.test(text)) {
      assert.equal(values[0], "project-1");
      assert.ok(["repository-1", "repository-a"].includes(values[1]));
      return { board_id: "board-1" };
    }

    throw new Error(`Unexpected query: ${text}`);
  }

  async query(text, values = []) {
    this.queries.push({ method: "query", text, values });
    assert.match(text, /FROM boards/i);
    if (values.length === 3) {
      assert.match(text, /AND b\.repository_id = \$3/i);
      assert.deepEqual(values, ["workspace-1", "project-1", "repository-a"]);
      return [{ project_v2_id: "project-1", repository_id: "repository-a" }];
    }

    assert.deepEqual(values, ["workspace-1", "project-1"]);
    return [{ project_v2_id: "project-1", repository_id: "repository-1" }];
  }

  async execute(text, values = []) {
    this.queries.push({ method: "execute", text, values });
    if (/INSERT INTO github_project_v2_repositories/i.test(text)) {
      assert.deepEqual(values, ["project-1", "repository-1"]);
      return { rowCount: 1 };
    }

    if (/DELETE FROM github_project_v2_item_field_values/i.test(text)) {
      assert.equal(values[0], "project-item-1");
      assert.ok(Array.isArray(values[1]));
      this.fieldValueNames = this.fieldValueNames.filter((fieldName) =>
        values[1].includes(fieldName)
      );
      return { rowCount: 1 };
    }

    if (/UPDATE github_project_v2_items/i.test(text)) {
      assert.deepEqual(values, ["workspace-1", "project-1", context.projectItemNodeId]);
      return { rowCount: 1 };
    }

    if (/INSERT INTO github_project_v2_item_field_values/i.test(text)) {
      assert.deepEqual(values.slice(0, 5), [
        "project-item-1",
        "field-1",
        "PVTFV_later-page",
        "Implementation note",
        "TEXT"
      ]);
      assert.equal(values[5], "Persisted from the later page");
      this.fieldValueNames = [
        ...this.fieldValueNames.filter((fieldName) => fieldName !== values[3]),
        values[3]
      ];
      return { rowCount: 1 };
    }

    throw new Error(`Unexpected execute: ${text}`);
  }
}

function reconcileContext(repository = null) {
  return {
    currentUserId: "user-1",
    workspaceId: "workspace-1",
    installation: {
      id: "installation-1",
      workspace_id: "workspace-1",
      github_installation_id: 123,
      account_login: "example",
      account_type: "Organization"
    },
    repository,
    projectV2: {
      id: "project-1",
      workspace_id: "workspace-1",
      installation_id: "installation-1",
      github_project_node_id: context.projectV2NodeId
    },
    githubUserAccessToken: null,
    config: {
      appId: "12345",
      privateKey: "unused",
      now: () => new Date("2026-07-11T09:00:00.000Z")
    }
  };
}

class DeliveryLeaseFakeDatabase {
  constructor({
    deliveryId,
    status = "received",
    leaseExpired = false,
    projectV2Context = true
  }) {
    this.delivery = {
      delivery_id: deliveryId,
      status,
      lease_expires_at: leaseExpired ? receivedAt : "2026-07-11T10:00:00.000Z",
      attempt_count: 0
    };
    this.projectV2Context = projectV2Context;
    this.queries = [];
    this.updates = [];
  }

  async queryOne(text, values = []) {
    this.queries.push({ method: "queryOne", text, values });
    assert.match(text, /UPDATE github_webhook_deliveries/i);
    assert.match(text, /status\s*=\s*'received'/i);
    assert.match(text, /status\s*=\s*'processing'/i);
    assert.match(text, /lease_expires_at\s*<\s*now\(\)/i);
    assert.match(text, /attempt_count\s*=\s*.*attempt_count\s*\+\s*1/i);
    assert.match(text, /lease_owner\s*=\s*\$2/i);
    assert.match(text, /interval '10 minutes'/i);
    assert.doesNotMatch(text, /JOIN github_projects_v2/i);
    assert.doesNotMatch(text, /JOIN github_project_v2_selections/i);

    const claimable = (
      this.delivery.status === "received" ||
      (this.delivery.status === "processing" && this.delivery.lease_expires_at === receivedAt)
    );
    if (!claimable) return null;

    this.delivery.status = "processing";
    this.delivery.attempt_count += 1;
    this.delivery.lease_owner = values[1];
    this.delivery.lease_expires_at = "2026-07-11T09:10:00.000Z";
    return {
      delivery_id: this.delivery.delivery_id,
      project_item_node_id: context.projectItemNodeId,
      github_installation_id: context.githubInstallationId,
      project_v2_node_id: context.projectV2NodeId
    };
  }

  async query(text, values = []) {
    this.queries.push({ method: "query", text, values });
    assert.match(text, /FROM github_installations/i);
    assert.match(text, /JOIN github_projects_v2/i);
    assert.match(text, /JOIN github_project_v2_selections/i);
    assert.match(text, /owner_type\s*=\s*'Organization'/i);
    assert.deepEqual(values, [context.githubInstallationId, context.projectV2NodeId]);

    return this.projectV2Context ? [{
      workspace_id: "workspace-1",
      installation_id: "installation-1",
      github_installation_id: context.githubInstallationId,
      account_login: "example",
      account_type: "Organization",
      project_v2_id: "project-1",
      project_v2_installation_id: "installation-1",
      project_v2_workspace_id: "workspace-1",
      github_project_node_id: context.projectV2NodeId
    }] : [];
  }

  async execute(text, values = []) {
    const update = { method: "execute", text, values };
    this.queries.push(update);
    this.updates.push(update);

    if (/status='processed'/i.test(text)) {
      this.delivery.status = "processed";
      this.delivery.lease_owner = null;
      this.delivery.lease_expires_at = null;
      return { rowCount: 1 };
    }

    if (/status='received'/i.test(text)) {
      this.delivery.status = "received";
      this.delivery.lease_owner = null;
      this.delivery.lease_expires_at = null;
      this.delivery.error_message = values.at(-1);
      return { rowCount: 1 };
    }

    throw new Error(`Unexpected execute: ${text}`);
  }
}

class ExpiredLeaseRecoveryFakeDatabase {
  constructor(deliveryId) {
    this.delivery = {
      delivery_id: deliveryId,
      status: "received",
      lease_expires_at: null,
      attempt_count: 0
    };
    this.failRetryRelease = true;
    this.failRecoveryFailureTransition = false;
    this.queries = [];
  }

  expireLease() {
    this.delivery.lease_expires_at = receivedAt;
  }

  async queryOne(text, values = []) {
    this.queries.push({ method: "queryOne", text, values });
    assert.match(text, /UPDATE github_webhook_deliveries/i);
    assert.match(text, /attempt_count\s*=\s*.*attempt_count\s*\+\s*1/i);

    const claimable = this.delivery.status === "received" ||
      (this.delivery.status === "processing" && this.delivery.lease_expires_at === receivedAt);
    if (!claimable) return null;

    this.delivery.status = "processing";
    this.delivery.attempt_count += 1;
    this.delivery.lease_owner = values[1];
    this.delivery.lease_expires_at = "2026-07-11T09:10:00.000Z";
    return {
      delivery_id: this.delivery.delivery_id,
      project_item_node_id: context.projectItemNodeId,
      workspace_id: "workspace-1",
      installation_id: "installation-1",
      github_installation_id: context.githubInstallationId,
      project_v2_node_id: context.projectV2NodeId,
      account_login: "example",
      account_type: "Organization",
      project_v2_id: "project-1",
      project_v2_installation_id: "installation-1",
      project_v2_workspace_id: "workspace-1",
      github_project_node_id: context.projectV2NodeId
    };
  }

  async query(text, values = []) {
    this.queries.push({ method: "query", text });
    if (/FROM github_installations/i.test(text)) {
      assert.deepEqual(values, [context.githubInstallationId, context.projectV2NodeId]);
      return [{
        workspace_id: "workspace-1",
        installation_id: "installation-1",
        github_installation_id: context.githubInstallationId,
        account_login: "example",
        account_type: "Organization",
        project_v2_id: "project-1",
        project_v2_installation_id: "installation-1",
        project_v2_workspace_id: "workspace-1",
        github_project_node_id: context.projectV2NodeId
      }];
    }
    assert.match(text, /status\s*=\s*'failed'/i);
    assert.match(text, /status\s*=\s*'received'/i);
    assert.match(text, /status\s*=\s*'processing'/i);
    assert.match(text, /lease_expires_at\s*<\s*now\(\)/i);
    return (this.delivery.status === "failed" &&
      this.delivery.error_message === "GitHub webhook could not be enqueued") ||
      (this.delivery.status === "received" &&
        this.delivery.error_message === webhookEnqueuePendingMessage &&
        text.includes(webhookEnqueuePendingMessage)) ||
      (this.delivery.status === "processing" && this.delivery.lease_expires_at === receivedAt)
      ? [{ delivery_id: this.delivery.delivery_id }]
      : [];
  }

  async execute(text, values = []) {
    this.queries.push({ method: "execute", text, values });

    if (/error_message=\$3/i.test(text) && this.failRetryRelease) {
      throw new Error("database unavailable while releasing retry");
    }

    if (/SET\s+status='received',\s+processed_at=NULL,\s+error_message='GitHub webhook enqueue is publishing'/i.test(text) ||
      /SET\s+error_message='GitHub webhook enqueue is publishing',\s+lease_owner=\$2/i.test(text)) {
      this.delivery.status = "received";
      this.delivery.error_message = "GitHub webhook enqueue is publishing";
      this.delivery.lease_owner = values[1] ?? "publisher";
      this.delivery.lease_expires_at = "2026-07-11T09:10:00.000Z";
      return { rowCount: 1 };
    }

    if (/SET\s+error_message='GitHub webhook enqueue is pending'/i.test(text) ||
      values.includes(webhookEnqueuePendingMessage)) {
      this.delivery.status = "received";
      this.delivery.error_message = webhookEnqueuePendingMessage;
      this.delivery.lease_owner = null;
      this.delivery.lease_expires_at = null;
      return { rowCount: 1 };
    }

    if (/SET\s+status='failed'/i.test(text)) {
      if (this.failRecoveryFailureTransition) {
        throw new Error("database unavailable while preserving recovery state");
      }
      this.delivery.status = "failed";
      this.delivery.error_message = "GitHub webhook could not be enqueued";
      this.delivery.lease_owner = null;
      this.delivery.lease_expires_at = null;
      return { rowCount: 1 };
    }

    if (/SET\s+status='received'/i.test(text)) {
      this.delivery.status = "received";
      this.delivery.error_message = (text.includes(webhookEnqueuePendingMessage) ||
        values.includes(webhookEnqueuePendingMessage))
        ? webhookEnqueuePendingMessage
        : null;
      this.delivery.lease_owner = null;
      this.delivery.lease_expires_at = null;
      return { rowCount: 1 };
    }

    if (/SET\s+error_message=NULL/i.test(text)) {
      this.delivery.error_message = null;
      this.delivery.lease_owner = null;
      this.delivery.lease_expires_at = null;
      return { rowCount: 1 };
    }

    if (/status='processed'/i.test(text)) {
      this.delivery.status = "processed";
      this.delivery.lease_owner = null;
      this.delivery.lease_expires_at = null;
      return { rowCount: 1 };
    }

    throw new Error(`Unexpected execute: ${text}`);
  }
}

class RecoveryPublicationRaceFakeDatabase {
  constructor(deliveryId, { existing = true } = {}) {
    this.delivery = {
      delivery_id: deliveryId,
      event_name: "projects_v2_item",
      status: "failed",
      received_at: receivedAt,
      processed_at: receivedAt,
      error_message: "GitHub webhook could not be enqueued",
      lease_owner: null,
      lease_expires_at: null,
      attempt_count: 0,
      action: context.action,
      github_installation_id: context.githubInstallationId,
      project_v2_node_id: context.projectV2NodeId,
      project_item_node_id: context.projectItemNodeId
    };
    this.failRecoveryFailureTransition = false;
    this.failPublishingRelease = false;
    this.failPublishingAcknowledgement = false;
    this.hasExistingDelivery = existing;
    this.queries = [];
  }

  expirePublishingLease() {
    this.delivery.lease_expires_at = receivedAt;
  }

  async queryOne(text, values = []) {
    this.queries.push({ method: "queryOne", text, values });

    if (/UPDATE github_webhook_deliveries\b/i.test(text)) {
      if (this.delivery.status !== "received") return null;
      this.delivery.status = "processing";
      this.delivery.lease_owner = values[1];
      this.delivery.lease_expires_at = "2026-07-11T09:10:00.000Z";
      this.delivery.error_message = null;
      this.delivery.attempt_count += 1;
      return {
        delivery_id: this.delivery.delivery_id,
        project_item_node_id: context.projectItemNodeId,
        workspace_id: "workspace-1",
        installation_id: "installation-1",
        github_installation_id: context.githubInstallationId,
        project_v2_node_id: context.projectV2NodeId,
        account_login: "example",
        account_type: "Organization",
        project_v2_id: "project-1",
        project_v2_installation_id: "installation-1",
        project_v2_workspace_id: "workspace-1",
        github_project_node_id: context.projectV2NodeId
      };
    }

    if (/FROM github_webhook_deliveries/i.test(text)) {
      return this.hasExistingDelivery ? this.delivery : null;
    }

    if (/FROM github_installations/i.test(text)) {
      assert.deepEqual(values, [context.githubInstallationId, context.projectV2NodeId]);
      return { id: "project-1" };
    }

    if (/INSERT INTO github_webhook_deliveries/i.test(text)) {
      this.hasExistingDelivery = true;
      this.delivery = {
        ...this.delivery,
        delivery_id: values[0],
        event_name: values[1],
        status: values[2],
        processed_at: values[2] === "received" ? null : receivedAt,
        error_message: values[7],
        action: values[3],
        github_installation_id: values[4],
        project_v2_node_id: values[5],
        project_item_node_id: values[6]
      };
      return this.delivery;
    }

    throw new Error(`Unexpected queryOne: ${text}`);
  }

  async query(text, values = []) {
    this.queries.push({ method: "query", text });
    if (/FROM github_installations/i.test(text)) {
      assert.deepEqual(values, [context.githubInstallationId, context.projectV2NodeId]);
      return [{
        workspace_id: "workspace-1",
        installation_id: "installation-1",
        github_installation_id: context.githubInstallationId,
        account_login: "example",
        account_type: "Organization",
        project_v2_id: "project-1",
        project_v2_installation_id: "installation-1",
        project_v2_workspace_id: "workspace-1",
        github_project_node_id: context.projectV2NodeId
      }];
    }
    assert.match(text, /status\s*=\s*'failed'/i);
    assert.match(text, /status\s*=\s*'received'/i);
    assert.match(text, /GitHub webhook could not be enqueued/);
    return (this.delivery.status === "failed" &&
      this.delivery.error_message === "GitHub webhook could not be enqueued") ||
      (this.delivery.status === "received" &&
        this.delivery.error_message === webhookEnqueuePendingMessage &&
        text.includes(webhookEnqueuePendingMessage)) ||
      (this.delivery.status === "received" &&
        this.delivery.error_message === "GitHub webhook enqueue is publishing" &&
        this.delivery.lease_expires_at === receivedAt &&
        text.includes("GitHub webhook enqueue is publishing"))
      ? [{ delivery_id: this.delivery.delivery_id }]
      : [];
  }

  async execute(text, values = []) {
    this.queries.push({ method: "execute", text, values });

    if (/status='processed'/i.test(text)) {
      if (/NOT EXISTS/i.test(text)) return { rowCount: 0 };
      if (this.delivery.status !== "processing") return { rowCount: 0 };
      this.delivery.status = "processed";
      this.delivery.processed_at = receivedAt;
      this.delivery.error_message = null;
      this.delivery.lease_owner = null;
      this.delivery.lease_expires_at = null;
      return { rowCount: 1 };
    }

    if (/SET\s+status='received',\s+processed_at=NULL,\s+error_message='GitHub webhook enqueue is publishing'/i.test(text) ||
      /SET\s+error_message='GitHub webhook enqueue is publishing',\s+lease_owner=\$2/i.test(text)) {
      if (this.delivery.error_message === "GitHub webhook enqueue is publishing" &&
        this.delivery.lease_expires_at !== receivedAt) {
        return { rowCount: 0 };
      }
      this.delivery.status = "received";
      this.delivery.processed_at = null;
      this.delivery.error_message = "GitHub webhook enqueue is publishing";
      this.delivery.lease_owner = values[1] ?? "publisher";
      this.delivery.lease_expires_at = "2026-07-11T09:10:00.000Z";
      return { rowCount: 1 };
    }

    if (/SET\s+error_message='GitHub webhook enqueue is pending'/i.test(text) ||
      values.includes(webhookEnqueuePendingMessage)) {
      if (this.failPublishingRelease) {
        this.failPublishingRelease = false;
        throw new Error("database unavailable while releasing publishing lease");
      }
      this.delivery.status = "received";
      this.delivery.error_message = webhookEnqueuePendingMessage;
      this.delivery.lease_owner = null;
      this.delivery.lease_expires_at = null;
      return { rowCount: 1 };
    }

    if (/SET\s+status='received'/i.test(text)) {
      this.delivery.status = "received";
      this.delivery.processed_at = null;
      this.delivery.error_message = (text.includes(webhookEnqueuePendingMessage) ||
        values.includes(webhookEnqueuePendingMessage))
        ? webhookEnqueuePendingMessage
        : null;
      this.delivery.lease_owner = null;
      this.delivery.lease_expires_at = null;
      return { rowCount: 1 };
    }

    if (/SET\s+status='failed'/i.test(text)) {
      if (this.failRecoveryFailureTransition) {
        throw new Error("database unavailable while preserving recovery state");
      }
      if (this.delivery.status === "received") {
        this.delivery.status = "failed";
        this.delivery.error_message = values.at(-1);
      }
      return { rowCount: 1 };
    }

    if (/SET\s+error_message=NULL/i.test(text)) {
      if (this.failPublishingAcknowledgement) {
        this.failPublishingAcknowledgement = false;
        throw new Error("database unavailable while acknowledging publication");
      }
      if (this.delivery.status === "received") {
        this.delivery.error_message = null;
        this.delivery.lease_owner = null;
        this.delivery.lease_expires_at = null;
      }
      return { rowCount: 1 };
    }

    throw new Error(`Unexpected execute: ${text}`);
  }
}

class ConcurrentPendingRecoveryFakeDatabase {
  constructor(deliveryId) {
    this.delivery = {
      delivery_id: deliveryId,
      status: "received",
      error_message: webhookEnqueuePendingMessage,
      lease_owner: null,
      lease_expires_at: null
    };
  }

  async query(text) {
    assert.match(text, /status\s*=\s*'received'/i);
    assert.match(text, new RegExp(webhookEnqueuePendingMessage));
    return this.delivery.error_message === webhookEnqueuePendingMessage
      ? [{ delivery_id: this.delivery.delivery_id }]
      : [];
  }

  async execute(text, values = []) {
    if (/SET\s+status='received'/i.test(text)) {
      if (text.includes("GitHub webhook enqueue is publishing")) {
        if (this.delivery.error_message !== webhookEnqueuePendingMessage) {
          return { rowCount: 0 };
        }
        this.delivery.error_message = "GitHub webhook enqueue is publishing";
        this.delivery.lease_owner = values[1];
        this.delivery.lease_expires_at = "2026-07-11T09:10:00.000Z";
        return { rowCount: 1 };
      }

      if (this.delivery.error_message !== webhookEnqueuePendingMessage) {
        return { rowCount: 0 };
      }
      return { rowCount: 1 };
    }

    if (/SET\s+error_message=NULL/i.test(text)) {
      this.delivery.error_message = null;
      this.delivery.lease_owner = null;
      this.delivery.lease_expires_at = null;
      return { rowCount: 1 };
    }

    if (/SET\s+error_message='GitHub webhook enqueue is pending'/i.test(text)) {
      this.delivery.error_message = webhookEnqueuePendingMessage;
      this.delivery.lease_owner = null;
      this.delivery.lease_expires_at = null;
      return { rowCount: 1 };
    }

    throw new Error(`Unexpected execute: ${text}`);
  }
}

class ReconcileFailedRecoveryFakeDatabase {
  constructor() {
    this.delivery = {
      delivery_id: "reconcile-failed-delivery",
      status: "received",
      error_message: null,
      lease_owner: null,
      lease_expires_at: null
    };
    this.retryCooldownExpired = false;
    this.targets = [{
      workspace_id: "workspace-1",
      installation_id: "installation-1",
      github_installation_id: context.githubInstallationId,
      account_login: "example",
      account_type: "Organization",
      project_v2_id: "project-1",
      project_v2_installation_id: "installation-1",
      project_v2_workspace_id: "workspace-1",
      github_project_node_id: context.projectV2NodeId
    }];
  }

  expireRetryCooldown() {
    this.retryCooldownExpired = true;
    this.delivery.lease_expires_at = receivedAt;
  }

  async queryOne(text, values = []) {
    assert.match(text, /UPDATE github_webhook_deliveries\b/i);
    if (this.delivery.status !== "received") return null;

    this.delivery.status = "processing";
    this.delivery.error_message = null;
    this.delivery.lease_owner = values[1];
    this.delivery.lease_expires_at = "2026-07-11T09:10:00.000Z";
    return {
      delivery_id: this.delivery.delivery_id,
      project_item_node_id: context.projectItemNodeId,
      github_installation_id: context.githubInstallationId,
      project_v2_node_id: context.projectV2NodeId
    };
  }

  async query(text) {
    if (/FROM github_installations/i.test(text)) {
      return this.targets;
    }

    const hasRetryCooldownGuard =
      /lease_expires_at < now\(\)\s+OR lease_expires_at IS NULL/i.test(text);
    return this.delivery.status === "received" &&
      this.delivery.error_message === "GitHub ProjectV2 webhook reconcile failed" &&
      text.includes("GitHub ProjectV2 webhook reconcile failed") &&
      (this.retryCooldownExpired || !hasRetryCooldownGuard)
      ? [{ delivery_id: this.delivery.delivery_id }]
      : [];
  }

  async execute(text, values = []) {
    if (/error_message=\$3/i.test(text)) {
      this.delivery.status = "received";
      this.delivery.error_message = values[2];
      this.delivery.lease_owner = null;
      this.delivery.lease_expires_at = /interval '6 minutes'/i.test(text)
        ? "2026-07-11T09:06:00.000Z"
        : null;
      return { rowCount: 1 };
    }

    if (/SET\s+status='received',\s+processed_at=NULL,\s+error_message='GitHub webhook enqueue is publishing'/i.test(text)) {
      if (!text.includes("GitHub ProjectV2 webhook reconcile failed")) {
        return { rowCount: 0 };
      }
      const hasRetryCooldownGuard =
        /lease_expires_at < now\(\)\s+OR lease_expires_at IS NULL/i.test(text);
      if (!this.retryCooldownExpired && hasRetryCooldownGuard) {
        return { rowCount: 0 };
      }
      this.delivery.error_message = "GitHub webhook enqueue is publishing";
      this.delivery.lease_owner = values[1];
      this.delivery.lease_expires_at = "2026-07-11T09:10:00.000Z";
      return { rowCount: 1 };
    }

    if (/SET\s+error_message=NULL/i.test(text)) {
      this.delivery.error_message = null;
      this.delivery.lease_owner = null;
      this.delivery.lease_expires_at = null;
      return { rowCount: 1 };
    }

    throw new Error(`Unexpected execute: ${text}`);
  }
}

class RepositoryScopedDeliveryFakeDatabase {
  constructor(deliveryId) {
    this.delivery = {
      delivery_id: deliveryId,
      status: "received",
      error_message: null,
      lease_owner: null,
      lease_expires_at: null
    };
    this.targets = [
      {
        workspace_id: "workspace-1",
        installation_id: "installation-1",
        github_installation_id: context.githubInstallationId,
        account_login: "example",
        account_type: "Organization",
        project_v2_id: "project-1",
        project_v2_installation_id: "installation-1",
        project_v2_workspace_id: "workspace-1",
        github_project_node_id: context.projectV2NodeId,
        repository_id: "repository-a",
        repository_workspace_id: "workspace-1",
        repository_installation_id: "installation-1",
        repository_github_node_id: "R_kgDORepositoryA",
        repository_owner_login: "example",
        repository_name: "repository-a",
        repository_full_name: "example/repository-a"
      },
      {
        workspace_id: "workspace-1",
        installation_id: "installation-1",
        github_installation_id: context.githubInstallationId,
        account_login: "example",
        account_type: "Organization",
        project_v2_id: "project-1",
        project_v2_installation_id: "installation-1",
        project_v2_workspace_id: "workspace-1",
        github_project_node_id: context.projectV2NodeId,
        repository_id: "repository-b",
        repository_workspace_id: "workspace-1",
        repository_installation_id: "installation-1",
        repository_github_node_id: "R_kgDORepositoryB",
        repository_owner_login: "example",
        repository_name: "repository-b",
        repository_full_name: "example/repository-b"
      }
    ];
  }

  async queryOne(text, values = []) {
    assert.match(text, /UPDATE github_webhook_deliveries\b/i);
    if (this.delivery.status !== "received") return null;

    this.delivery.status = "processing";
    this.delivery.error_message = null;
    this.delivery.lease_owner = values[1];
    this.delivery.lease_expires_at = "2026-07-11T09:10:00.000Z";
    return {
      delivery_id: this.delivery.delivery_id,
      project_item_node_id: context.projectItemNodeId,
      project_v2_node_id: context.projectV2NodeId,
      ...this.targets[0]
    };
  }

  async query(text, values = []) {
    assert.match(text, /FROM github_installations/i);
    assert.deepEqual(values, [context.githubInstallationId, context.projectV2NodeId]);
    return this.targets;
  }

  async execute(text, values = []) {
    if (/status='processed'/i.test(text)) {
      if (this.delivery.status !== "processing") return { rowCount: 0 };
      this.delivery.status = "processed";
      this.delivery.error_message = null;
      this.delivery.lease_owner = null;
      this.delivery.lease_expires_at = null;
      return { rowCount: 1 };
    }

    if (/error_message=\$3/i.test(text)) {
      if (this.delivery.status !== "processing") return { rowCount: 0 };
      this.delivery.status = "received";
      this.delivery.error_message = values[2];
      this.delivery.lease_owner = null;
      this.delivery.lease_expires_at = null;
      return { rowCount: 1 };
    }

    throw new Error(`Unexpected execute: ${text}`);
  }
}

function createDeliveryReconcileService(database, { getProjectV2Item, reconcile, archive }) {
  return new GithubProjectV2WebhookReconcileService(
    database,
    { getGithubAppConfig: () => ({ appId: "12345", privateKey: "unused" }) },
    { getProjectV2Item },
    {
      reconcileGithubProjectV2WebhookItem: reconcile,
      archiveGithubProjectV2WebhookItem: archive
    }
  );
}

{
  const [apiContract, workerSource, reconcileSource] = await Promise.all([
    readFile(new URL("../../../../docs/api/github-integration-api.md", import.meta.url), "utf8"),
    readFile(new URL("../../src/modules/github-integration/github-sync-job.service.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/modules/github-integration/github-project-v2-webhook-reconcile.service.ts", import.meta.url), "utf8")
  ]);

  assert.match(apiContract, /selected `projects_v2_item` delivery/i);
  assert.match(apiContract, /ignored.*SQS.*GraphQL/i);
  assert.match(apiContract, /lease.*retry/i);
  assert.match(apiContract, /unselected queued delivery.*processed.*without GitHub GraphQL/i);
  assert.match(apiContract, /projectItemNodeId-only GitHub GraphQL source-of-truth fetch/i);
  assert.match(apiContract, /missing target.*archives.*matching local item.*existing Board cache/i);
  assert.match(apiContract, /processing` lease[\s\S]*recovery and requeue/i);
  assert.match(apiContract, /pending publication marker/i);
  assert.match(apiContract, /publishing lease/i);
  assert.match(apiContract, /one GitHub GraphQL target-item fetch.*all matching selected repository targets/i);
  assert.match(apiContract, /GitHub ProjectV2 webhook reconcile failed[\s\S]*recoverable/i);
  assert.match(apiContract, /\(repository_id, project_v2_id\).*Board hydration/i);
  assert.match(apiContract, /field values are a current GitHub snapshot[\s\S]*before Board hydration/i);
  assert.match(apiContract, /six-minute SQS redrive cooldown[\s\S]*SQS redelivery remains the primary retry path/i);
  assert.doesNotMatch(apiContract, /receiver.*does not.*background job/i);
  assert.doesNotMatch(workerSource, /FROM github_webhook_deliveries/i);
  assert.match(reconcileSource, /SELECT delivery_id FROM github_webhook_deliveries/i);
  assert.match(reconcileSource, /status\s*=\s*'processing'\s+AND lease_expires_at < now\(\)/i);
}

{
  const database = new RepositoryScopedDeliveryFakeDatabase("repository-scoped-delivery");
  let graphqlLookups = 0;
  const reconciledRepositoryIds = [];
  const boardHydrationRepositoryIds = [];
  const reconcileService = createDeliveryReconcileService(database, {
    getProjectV2Item: async () => {
      graphqlLookups += 1;
      return { item: { id: context.projectItemNodeId } };
    },
    reconcile: async (syncContext) => {
      reconciledRepositoryIds.push(syncContext.repository?.id ?? null);
      boardHydrationRepositoryIds.push(syncContext.repository?.id ?? null);
    },
    archive: async () => {}
  });

  assert.equal(await reconcileService.processDelivery(database.delivery.delivery_id), "terminal");
  assert.equal(graphqlLookups, 1);
  assert.deepEqual(reconciledRepositoryIds.sort(), ["repository-a", "repository-b"]);
  assert.deepEqual(boardHydrationRepositoryIds.sort(), ["repository-a", "repository-b"]);
  assert.equal(database.delivery.status, "processed");
}

{
  const database = new RepositoryScopedDeliveryFakeDatabase("partial-repository-scoped-delivery");
  const reconcileService = createDeliveryReconcileService(database, {
    getProjectV2Item: async () => ({ item: { id: context.projectItemNodeId } }),
    reconcile: async (syncContext) => {
      if (syncContext.repository?.id === "repository-b") {
        throw new Error("repository-b reconciliation failed");
      }
    },
    archive: async () => {}
  });

  assert.equal(await reconcileService.processDelivery(database.delivery.delivery_id), "retry");
  assert.notEqual(database.delivery.status, "processed");
  assert.equal(
    database.delivery.error_message,
    "GitHub ProjectV2 webhook reconcile failed"
  );
}

{
  const database = new ReconcileFailedRecoveryFakeDatabase();
  const reconcileService = createDeliveryReconcileService(database, {
    getProjectV2Item: async () => ({ item: { id: context.projectItemNodeId } }),
    reconcile: async () => {
      throw new Error("reconcile failed");
    },
    archive: async () => {}
  });
  const published = [];

  assert.equal(await reconcileService.processDelivery(database.delivery.delivery_id), "retry");
  assert.deepEqual(database.delivery, {
    delivery_id: "reconcile-failed-delivery",
    status: "received",
    error_message: "GitHub ProjectV2 webhook reconcile failed",
    lease_owner: null,
    lease_expires_at: "2026-07-11T09:06:00.000Z"
  });

  await reconcileService.recoverDeliveries(async (deliveryId) => {
    published.push(deliveryId);
  });

  assert.deepEqual(published, []);

  database.expireRetryCooldown();
  await reconcileService.recoverDeliveries(async (deliveryId) => {
    published.push(deliveryId);
  });

  assert.deepEqual(published, ["reconcile-failed-delivery"]);
  assert.equal(database.delivery.error_message, null);
  assert.equal(database.delivery.lease_owner, null);
}

{
  const deliveryId = "projects-v2-item-delivery-success";
  const database = new DeliveryLeaseFakeDatabase({ deliveryId });
  const graphqlCalls = [];
  const reconcileService = createDeliveryReconcileService(database, {
    getProjectV2Item: async (input) => {
      graphqlCalls.push(input);
      return { item: { id: context.projectItemNodeId } };
    },
    reconcile: async () => {},
    archive: async () => {}
  });

  assert.equal(await reconcileService.processDelivery(deliveryId), "terminal");
  assert.equal(graphqlCalls.length, 1);
  assert.match(database.updates.at(-1).text, /status='processed'/);
}

{
  const deliveryId = "projects-v2-item-delivery-retry";
  const database = new DeliveryLeaseFakeDatabase({ deliveryId });
  const retryingService = createDeliveryReconcileService(database, {
    getProjectV2Item: async () => {
      throw new Error("provider token=secret private_key=private rawBody=payload");
    },
    reconcile: async () => {},
    archive: async () => {}
  });

  assert.equal(await retryingService.processDelivery(deliveryId), "retry");
  assert.match(database.updates.at(-1).text, /status='received'/);
  assert.doesNotMatch(database.updates.at(-1).text, /token|private_key|rawBody/i);
  assert.doesNotMatch(database.delivery.error_message, /token|private_key|rawBody/i);
}

{
  const deliveryId = "projects-v2-item-active-lease";
  const database = new DeliveryLeaseFakeDatabase({ deliveryId, status: "processing" });
  const graphqlCalls = [];
  const leasedService = createDeliveryReconcileService(database, {
    getProjectV2Item: async () => {
      graphqlCalls.push("called");
      return null;
    },
    reconcile: async () => {},
    archive: async () => {}
  });

  assert.equal(await leasedService.processDelivery(deliveryId), "terminal");
  assert.equal(graphqlCalls.length, 0, "active lease must not be processed twice");
}

{
  const deliveryId = "non-project-v2-delivery";
  const database = new DeliveryLeaseFakeDatabase({
    deliveryId,
    projectV2Context: false
  });
  const graphqlCalls = [];
  const reconcileService = createDeliveryReconcileService(database, {
    getProjectV2Item: async () => {
      graphqlCalls.push("called");
      return null;
    },
    reconcile: async () => {},
    archive: async () => {}
  });

  assert.equal(await reconcileService.processDelivery(deliveryId), "terminal");
  assert.equal(graphqlCalls.length, 0, "unmatched delivery must not call GitHub");
  assert.match(database.updates.at(-1).text, /status='processed'/);
}

{
  const deliveryId = "projects-v2-item-expired-lease";
  const database = new DeliveryLeaseFakeDatabase({
    deliveryId,
    status: "processing",
    leaseExpired: true
  });
  const graphqlCalls = [];
  const expiredLeaseService = createDeliveryReconcileService(database, {
    getProjectV2Item: async () => {
      graphqlCalls.push("called");
      return null;
    },
    reconcile: async () => {},
    archive: async () => {}
  });

  assert.equal(await expiredLeaseService.processDelivery(deliveryId), "terminal");
  assert.equal(graphqlCalls.length, 1, "expired lease must become claimable again");
  assert.match(database.updates.at(-1).text, /status='processed'/);
}

{
  const deliveryId = "projects-v2-item-retry-release-recovery";
  const database = new ExpiredLeaseRecoveryFakeDatabase(deliveryId);
  const retryingService = createDeliveryReconcileService(database, {
    getProjectV2Item: async () => {
      throw new Error("provider unavailable");
    },
    reconcile: async () => {},
    archive: async () => {}
  });

  assert.equal(await retryingService.processDelivery(deliveryId), "retry");
  assert.equal(database.delivery.status, "processing");

  database.expireLease();
  database.failRecoveryFailureTransition = true;
  await retryingService.recoverDeliveries(async () => {
    throw new Error("SQS unavailable");
  });
  assert.equal(database.delivery.status, "received", "failed publication must leave a runnable recovery row");
  assert.equal(
    database.delivery.error_message,
    webhookEnqueuePendingMessage,
    "the recovery marker must survive a failed compensating write"
  );
  database.failRecoveryFailureTransition = false;

  const worker = new GithubSyncJobService(database, {}, {}, {}, retryingService);
  const republished = [];
  worker.client = () => ({
    send: async (command) => {
      republished.push(command.constructor.name);
      return {};
    }
  });
  process.env.SQS_GITHUB_WEBHOOKS_QUEUE_URL = "queue-url";

  await worker.recoverWebhookOutbox();
  await worker.recoverWebhookOutbox();
  assert.deepEqual(republished, ["SendMessageCommand"]);
  assert.equal(database.delivery.status, "received");

  const reclaimedService = createDeliveryReconcileService(database, {
    getProjectV2Item: async () => ({ item: { id: context.projectItemNodeId } }),
    reconcile: async () => {},
    archive: async () => {}
  });
  assert.equal(await reclaimedService.processDelivery(deliveryId), "terminal");
  assert.equal(database.delivery.status, "processed");
}

{
  const deliveryId = "projects-v2-item-outbox-publication-race";
  const database = new RecoveryPublicationRaceFakeDatabase(deliveryId);
  let statusWhenPublished;
  let graphqlCalls = 0;
  const reconcileService = createDeliveryReconcileService(database, {
    getProjectV2Item: async () => {
      graphqlCalls += 1;
      return { item: { id: context.projectItemNodeId } };
    },
    reconcile: async () => {},
    archive: async () => {}
  });

  await reconcileService.recoverDeliveries(async (publishedDeliveryId) => {
    assert.equal(publishedDeliveryId, deliveryId);
    statusWhenPublished = database.delivery.status;
    assert.equal(await reconcileService.processDelivery(publishedDeliveryId), "terminal");
  });

  assert.equal(statusWhenPublished, "received", "outbox must publish only after the delivery is claimable");
  assert.equal(graphqlCalls, 1, "the fast worker must claim and reconcile the published recovery");
  assert.equal(database.delivery.status, "processed", "outbox recovery must not strand a published delivery");
}

{
  const deliveryId = "projects-v2-item-concurrent-pending-recovery";
  const database = new ConcurrentPendingRecoveryFakeDatabase(deliveryId);
  const reconcileService = createDeliveryReconcileService(database, {
    getProjectV2Item: async () => null,
    reconcile: async () => {},
    archive: async () => {}
  });
  let publishCount = 0;
  let firstPublishReached;
  const firstPublishStarted = new Promise((resolve) => {
    firstPublishReached = resolve;
  });
  let releaseFirstPublish;
  const firstPublishBlocked = new Promise((resolve) => {
    releaseFirstPublish = resolve;
  });
  const enqueue = async () => {
    publishCount += 1;
    if (publishCount === 1) {
      firstPublishReached();
      await firstPublishBlocked;
    }
  };

  const firstRecovery = reconcileService.recoverDeliveries(enqueue);
  await firstPublishStarted;
  await reconcileService.recoverDeliveries(enqueue);
  releaseFirstPublish();
  await firstRecovery;

  assert.equal(publishCount, 1, "only one publisher may send a pending delivery");
}

{
  const deliveryId = "projects-v2-item-publishing-release-write-failure";
  const database = new RecoveryPublicationRaceFakeDatabase(deliveryId);
  database.failPublishingRelease = true;
  const reconcileService = createDeliveryReconcileService(database, {
    getProjectV2Item: async () => ({ item: { id: context.projectItemNodeId } }),
    reconcile: async () => {},
    archive: async () => {}
  });

  const failures = await reconcileService.recoverDeliveries(async () => {
    throw new Error("SQS unavailable");
  });
  assert.equal(failures.length, 1);
  assert.equal(database.delivery.error_message, "GitHub webhook enqueue is publishing");

  database.expirePublishingLease();
  let republished = 0;
  await reconcileService.recoverDeliveries(async (publishedDeliveryId) => {
    republished += 1;
    assert.equal(await reconcileService.processDelivery(publishedDeliveryId), "terminal");
  });

  assert.equal(republished, 1, "an expired publishing lease must republish exactly once");
  assert.equal(database.delivery.status, "processed");
}

{
  const deliveryId = "projects-v2-item-publishing-ack-write-failure";
  const database = new RecoveryPublicationRaceFakeDatabase(deliveryId);
  database.failPublishingAcknowledgement = true;
  const reconcileService = createDeliveryReconcileService(database, {
    getProjectV2Item: async () => ({ item: { id: context.projectItemNodeId } }),
    reconcile: async () => {},
    archive: async () => {}
  });
  let initialPublications = 0;
  const failures = await reconcileService.recoverDeliveries(async () => {
    initialPublications += 1;
  });
  assert.equal(initialPublications, 1);
  assert.equal(failures.length, 1);
  assert.equal(database.delivery.error_message, "GitHub webhook enqueue is publishing");

  database.expirePublishingLease();
  let republished = 0;
  await reconcileService.recoverDeliveries(async (publishedDeliveryId) => {
    republished += 1;
    assert.equal(await reconcileService.processDelivery(publishedDeliveryId), "terminal");
  });

  assert.equal(republished, 1, "a failed publish acknowledgement must republish exactly once");
  assert.equal(database.delivery.status, "processed");
}

{
  const deliveryId = "projects-v2-item-duplicate-publication-race";
  const database = new RecoveryPublicationRaceFakeDatabase(deliveryId);
  let statusWhenPublished;
  let graphqlCalls = 0;
  const reconcileService = createDeliveryReconcileService(database, {
    getProjectV2Item: async () => {
      graphqlCalls += 1;
      return { item: { id: context.projectItemNodeId } };
    },
    reconcile: async () => {},
    archive: async () => {}
  });
  const webhookService = new GithubWebhookService(
    database,
    { getGithubWebhookConfig: () => ({ webhookSecret }) },
    {
      enqueueWebhookDelivery: async (publishedDeliveryId) => {
        statusWhenPublished = database.delivery.status;
        assert.equal(await reconcileService.processDelivery(publishedDeliveryId), "terminal");
      }
    }
  );
  const duplicate = await receive(webhookService, deliveryId, payload());

  assert.equal(duplicate.status, "received");
  assert.equal(statusWhenPublished, "received", "duplicate recovery must publish only after the delivery is claimable");
  assert.equal(graphqlCalls, 1, "the fast worker must claim and reconcile the duplicate recovery");
  assert.equal(database.delivery.status, "processed", "duplicate recovery must not strand a published delivery");
}

{
  const deliveryId = "projects-v2-item-duplicate-pending-recovery";
  const database = new RecoveryPublicationRaceFakeDatabase(deliveryId);
  database.failRecoveryFailureTransition = true;
  const webhookService = new GithubWebhookService(
    database,
    { getGithubWebhookConfig: () => ({ webhookSecret }) },
    {
      enqueueWebhookDelivery: async () => {
        throw new Error("SQS unavailable");
      }
    }
  );

  await assert.rejects(() => receive(webhookService, deliveryId, payload()));
  assert.equal(database.delivery.status, "received");
  assert.equal(
    database.delivery.error_message,
    webhookEnqueuePendingMessage,
    "duplicate recovery must retain a durable recovery marker after both failures"
  );

  database.failRecoveryFailureTransition = false;
  let graphqlCalls = 0;
  const reconcileService = createDeliveryReconcileService(database, {
    getProjectV2Item: async () => {
      graphqlCalls += 1;
      return { item: { id: context.projectItemNodeId } };
    },
    reconcile: async () => {},
    archive: async () => {}
  });
  let recoveryPublications = 0;
  await reconcileService.recoverDeliveries(async (publishedDeliveryId) => {
    recoveryPublications += 1;
    assert.equal(database.delivery.status, "received");
    assert.equal(await reconcileService.processDelivery(publishedDeliveryId), "terminal");
  });

  assert.equal(recoveryPublications, 1, "the pending duplicate delivery must be republished");
  assert.equal(graphqlCalls, 1);
  assert.equal(database.delivery.status, "processed");
}

{
  const deliveryId = "projects-v2-item-initial-pending-recovery";
  const database = new RecoveryPublicationRaceFakeDatabase(deliveryId, { existing: false });
  database.failRecoveryFailureTransition = true;
  const webhookService = new GithubWebhookService(
    database,
    { getGithubWebhookConfig: () => ({ webhookSecret }) },
    {
      enqueueWebhookDelivery: async () => {
        throw new Error("SQS unavailable");
      }
    }
  );

  await assert.rejects(() => receive(webhookService, deliveryId, payload()));
  assert.equal(database.delivery.status, "received");
  assert.equal(
    database.delivery.error_message,
    webhookEnqueuePendingMessage,
    "initial selected delivery must retain a durable recovery marker after both failures"
  );

  database.failRecoveryFailureTransition = false;
  let graphqlCalls = 0;
  const reconcileService = createDeliveryReconcileService(database, {
    getProjectV2Item: async () => {
      graphqlCalls += 1;
      return { item: { id: context.projectItemNodeId } };
    },
    reconcile: async () => {},
    archive: async () => {}
  });
  let recoveryPublications = 0;
  await reconcileService.recoverDeliveries(async (publishedDeliveryId) => {
    recoveryPublications += 1;
    assert.equal(database.delivery.status, "received");
    assert.equal(await reconcileService.processDelivery(publishedDeliveryId), "terminal");
  });

  assert.equal(recoveryPublications, 1, "the pending initial delivery must be republished");
  assert.equal(graphqlCalls, 1);
  assert.equal(database.delivery.status, "processed");
}

{
  const deliveryIds = [];
  const worker = new GithubSyncJobService(
    { execute: async () => ({ rowCount: 1 }) },
    {},
    {},
    {},
    { processDelivery: async (deliveryId) => {
      deliveryIds.push(deliveryId);
      return "retry";
    } }
  );

  assert.equal(await worker.processWebhookDelivery("delegated-delivery"), "retry");
  assert.deepEqual(deliveryIds, ["delegated-delivery"]);
}

let fetchedTargetItem;
{
  const originalFetch = globalThis.fetch;
  const graphqlCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(url.toString(), "https://api.github.com/graphql");
    assert.equal(options.headers?.Authorization, "Bearer user-oauth-token");
    const body = JSON.parse(options.body);
    graphqlCalls.push(body);
    if (body.query.includes("query PiloProjectV2ItemFieldValues(")) {
      assert.deepEqual(body.variables, {
        itemId: context.projectItemNodeId,
        cursor: "field-value-cursor-1"
      });
      return {
        ok: true,
        async json() {
          return {
            data: {
              node: {
                __typename: "ProjectV2Item",
                fieldValues: {
                  nodes: [laterPageFieldValue()],
                  pageInfo: {
                    hasNextPage: false,
                    endCursor: null
                  }
                }
              }
            }
          };
        }
      };
    }

    return {
      ok: true,
      async json() {
        return { data: { node: projectV2ItemNode() } };
      }
    };
  };

  try {
    fetchedTargetItem = await new GithubAppClient().getProjectV2Item({
      installationId: 123,
      appId: "12345",
      privateKey: "unused",
      projectItemNodeId: context.projectItemNodeId,
      userAccessToken: "user-oauth-token",
      accountType: "Organization"
    });

    assert.equal(graphqlCalls[0].variables.itemId, context.projectItemNodeId);
    assert.match(graphqlCalls[0].query, /on ProjectV2Item/);
    assert.doesNotMatch(graphqlCalls[0].query, /items\(first: 100/);
    assert.deepEqual(graphqlCalls[1].variables, {
      itemId: context.projectItemNodeId,
      cursor: "field-value-cursor-1"
    });
    assert.equal(fetchedTargetItem.item.id, context.projectItemNodeId);
    assert.equal(fetchedTargetItem.repositoryNodeId, "R_kgDOExample");
    assert.equal(fetchedTargetItem.issue.id, 609);
    assert.deepEqual(fetchedTargetItem.item.fieldValues.map((fieldValue) => ({
      id: fieldValue.id,
      name: fieldValue.fieldName,
      text: fieldValue.textValue
    })), [{
      id: "PVTFV_later-page",
      name: "Implementation note",
      text: "Persisted from the later page"
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return { data: { node: null } };
    }
  });

  try {
    const item = await new GithubAppClient().getProjectV2Item({
      installationId: 123,
      appId: "12345",
      privateKey: "unused",
      projectItemNodeId: context.projectItemNodeId,
      userAccessToken: "user-oauth-token",
      accountType: "Organization"
    });
    assert.equal(item, null, "a missing GitHub node must not become a provider error");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const database = new ReconcileFakeDatabase();
  const executor = new GithubSyncExecutorService(database, {});

  await executor.reconcileGithubProjectV2WebhookItem(reconcileContext(), fetchedTargetItem);

  const sql = database.queries;
  assert.ok(sql.some(({ text }) => /INSERT INTO github_issues/i.test(text)));
  assert.ok(sql.some(({ text }) => /INSERT INTO github_project_v2_items/i.test(text)));
  assert.ok(sql.some(({ text }) => /INSERT INTO github_project_v2_item_field_values/i.test(text)));
  assert.ok(sql.some(({ text }) => /hydrate_pilo_board_from_github/i.test(text)));
}

{
  const database = new ReconcileFakeDatabase();
  const executor = new GithubSyncExecutorService(database, {});

  await executor.reconcileGithubProjectV2WebhookItem(
    reconcileContext({
      id: "repository-a",
      workspace_id: "workspace-1",
      installation_id: "installation-1",
      github_node_id: "R_kgDORepositoryA",
      owner_login: "example",
      name: "repository-a",
      full_name: "example/repository-a"
    }),
    fetchedTargetItem
  );

  const boardSelection = database.queries.find(({ method, text }) =>
    method === "query" && /FROM boards/i.test(text)
  );
  const boardHydration = database.queries.find(({ method, text }) =>
    method === "queryOne" && /hydrate_pilo_board_from_github/i.test(text)
  );
  assert.deepEqual(boardSelection.values, ["workspace-1", "project-1", "repository-a"]);
  assert.deepEqual(boardHydration.values, ["project-1", "repository-a"]);
}

{
  const database = new ReconcileFakeDatabase({ fieldValueNames: ["Status"] });
  const executor = new GithubSyncExecutorService(database, {});

  await executor.reconcileGithubProjectV2WebhookItem(reconcileContext(), fetchedTargetItem);

  const snapshotDeleteIndex = database.queries.findIndex(({ text }) =>
    /DELETE FROM github_project_v2_item_field_values/i.test(text)
  );
  const snapshotDelete = database.queries[snapshotDeleteIndex];
  const fieldValueUpsertIndex = database.queries.findIndex(({ text }) =>
    /INSERT INTO github_project_v2_item_field_values/i.test(text)
  );
  const boardHydrationIndex = database.queries.findIndex(({ text }) =>
    /hydrate_pilo_board_from_github/i.test(text)
  );

  assert.ok(snapshotDeleteIndex >= 0, "missing GitHub field values must be deleted");
  assert.ok(snapshotDeleteIndex < fieldValueUpsertIndex, "field snapshot cleanup must precede upserts");
  assert.ok(snapshotDeleteIndex < boardHydrationIndex, "field snapshot cleanup must precede Board hydration");
  assert.deepEqual(snapshotDelete.values, ["project-item-1", ["Implementation note"]]);
  assert.deepEqual(database.fieldValueNames, ["Implementation note"]);
}

{
  const database = new ReconcileFakeDatabase();
  const executor = new GithubSyncExecutorService(database, {});

  await executor.reconcileGithubProjectV2WebhookItem(
    reconcileContext(),
    pullRequestWebhookItem()
  );

  const sql = database.queries;
  assert.ok(sql.some(({ text }) => /INSERT INTO github_pull_requests/i.test(text)));
  assert.ok(sql.some(({ text }) => /INSERT INTO github_project_v2_items/i.test(text)));
  assert.ok(sql.some(({ text }) => /hydrate_pilo_board_from_github/i.test(text)));
}

{
  const database = new ReconcileFakeDatabase();
  const executor = new GithubSyncExecutorService(database, {});

  await executor.archiveGithubProjectV2WebhookItem(
    reconcileContext(),
    context.projectItemNodeId
  );

  const sql = database.queries;
  const archiveIndex = sql.findIndex(({ text }) =>
    /UPDATE github_project_v2_items\s+SET is_archived\s*=\s*true/i.test(text)
  );
  const hydrationIndex = sql.findIndex(({ text }) =>
    /hydrate_pilo_board_from_github/i.test(text)
  );
  assert.ok(archiveIndex >= 0, "missing target must archive only the matching item row");
  assert.ok(archiveIndex < hydrationIndex, "archive must happen before Board hydration");
}

{
  const enqueuedDeliveryIds = [];
  const database = new FakeDatabase({ selected: true });
  const service = createService(database, enqueuedDeliveryIds);

  await receive(service, selectedDeliveryId, payload());

  const delivery = database.deliveries.get(selectedDeliveryId);
  assert.equal(enqueuedDeliveryIds.length, 1, "selected item must be queued");
  assert.equal(delivery.status, "received");
  assert.deepEqual(delivery.context, context);
}

{
  const enqueuedDeliveryIds = [];
  const database = new FakeDatabase({ selected: false });
  const service = createService(database, enqueuedDeliveryIds);

  await receive(service, unselectedDeliveryId, payload());

  const delivery = database.deliveries.get(unselectedDeliveryId);
  assert.equal(enqueuedDeliveryIds.length, 0, "unselected item must not be queued");
  assert.equal(delivery.status, "ignored");
  assert.match(delivery.error_message, /not selected/i);
}

{
  const enqueuedDeliveryIds = [];
  const database = new FakeDatabase({ selected: true });
  const service = createService(database, enqueuedDeliveryIds);

  await receive(
    service,
    invalidDeliveryId,
    payload({ projects_v2_item: { node_id: context.projectItemNodeId } })
  );

  const delivery = database.deliveries.get(invalidDeliveryId);
  assert.equal(enqueuedDeliveryIds.length, 0, "invalid item must not be queued");
  assert.equal(delivery.status, "ignored");
  assert.match(delivery.error_message, /context/i);
}

for (const status of ["received", "ignored"]) {
  const deliveryId = `projects-v2-item-duplicate-${status}`;
  const enqueuedDeliveryIds = [];
  const database = new FakeDatabase({
    selected: true,
    deliveries: [{
      delivery_id: deliveryId,
      event_name: "projects_v2_item",
      status,
      received_at: receivedAt,
      processed_at: status === "received" ? null : receivedAt,
      error_message: status === "ignored" ? "GitHub ProjectV2 webhook project is not selected" : null,
      context
    }]
  });
  const service = createService(database, enqueuedDeliveryIds);

  await receive(service, deliveryId, payload());

  assert.equal(enqueuedDeliveryIds.length, 0, `duplicate ${status} delivery must not be queued`);
}

{
  const deliveryId = "projects-v2-item-concurrent-duplicate";
  const enqueuedDeliveryIds = [];
  const database = new ConcurrentFakeDatabase();
  const service = createService(database, enqueuedDeliveryIds);

  await Promise.all([
    receive(service, deliveryId, payload()),
    receive(service, deliveryId, payload())
  ]);

  assert.equal(database.deliveryLookups, 3, "losing insert must read the winning delivery");
  assert.deepEqual(enqueuedDeliveryIds, [deliveryId], "concurrent duplicate delivery queues once");
}

console.log("projects v2 item webhook reconcile tests passed");
