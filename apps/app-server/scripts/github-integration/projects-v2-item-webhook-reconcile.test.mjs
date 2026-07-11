import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { GithubAppClient } = require("../../dist/modules/github-integration/github-app.client.js");
const { GithubSyncExecutorService } = require("../../dist/modules/github-integration/github-sync-executor.service.js");
const { GithubWebhookService } = require("../../dist/modules/github-integration/github-webhook.service.js");

const webhookSecret = "test-webhook-secret";
const receivedAt = "2026-07-11T09:00:00.000Z";
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

class ReconcileFakeDatabase {
  constructor() {
    this.queries = [];
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

    if (/INSERT INTO github_project_v2_items/i.test(text)) {
      assert.deepEqual(values.slice(0, 8), [
        "workspace-1",
        "project-1",
        context.projectItemNodeId,
        9001,
        "ISSUE",
        "issue-1",
        null,
        false
      ]);
      return { id: "project-item-1", created: false };
    }

    if (/hydrate_pilo_board_from_github/i.test(text)) {
      assert.deepEqual(values, ["project-1", "repository-1"]);
      return { board_id: "board-1" };
    }

    throw new Error(`Unexpected query: ${text}`);
  }

  async query(text, values = []) {
    this.queries.push({ method: "query", text, values });
    assert.match(text, /FROM boards/i);
    assert.deepEqual(values, ["workspace-1", "project-1"]);
    return [{ project_v2_id: "project-1", repository_id: "repository-1" }];
  }

  async execute(text, values = []) {
    this.queries.push({ method: "execute", text, values });
    if (/INSERT INTO github_project_v2_repositories/i.test(text)) {
      assert.deepEqual(values, ["project-1", "repository-1"]);
      return { rowCount: 1 };
    }

    if (/UPDATE github_project_v2_items/i.test(text)) {
      assert.deepEqual(values, ["workspace-1", "project-1", context.projectItemNodeId]);
      return { rowCount: 1 };
    }

    throw new Error(`Unexpected execute: ${text}`);
  }
}

function reconcileContext() {
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
    repository: null,
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
                  nodes: [],
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
