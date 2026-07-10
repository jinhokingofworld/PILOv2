import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  createGithubSyncProgressCursor,
  getGithubFullSyncProjectProgressPercent,
  readGithubSyncProgress
} = require("../../dist/modules/github-integration/github-sync-progress.js");
const {
  GithubSyncExecutorService
} = require("../../dist/modules/github-integration/github-sync-executor.service.js");
const {
  GithubSyncRunService
} = require("../../dist/modules/github-integration/github-sync-run.service.js");

assert.deepEqual(readGithubSyncProgress("success", {}), {
  progressPercent: 100,
  progressStage: "completed"
});

assert.deepEqual(
  readGithubSyncProgress("running", {
    progress: {
      percent: 45,
      stage: "issues"
    }
  }),
  {
    progressPercent: 45,
    progressStage: "issues"
  }
);

assert.deepEqual(
  readGithubSyncProgress("running", {
    progress: {
      percent: 101,
      stage: "unknown"
    }
  }),
  {
    progressPercent: 0,
    progressStage: "initializing"
  }
);

assert.deepEqual(createGithubSyncProgressCursor(65, "pull_requests"), {
  percent: 65,
  stage: "pull_requests"
});

assert.deepEqual(
  [1, 2, 3].map((completedSteps) =>
    getGithubFullSyncProjectProgressPercent(completedSteps, 3)
  ),
  [75, 85, 95]
);
assert.equal(getGithubFullSyncProjectProgressPercent(0, 0), 95);

{
  const progressUpdates = [];
  const database = {
    async queryOne() {
      return {
        id: "repository-id",
        created: true
      };
    },
    async execute() {
      return {
        rows: [],
        rowCount: 1
      };
    }
  };
  const githubAppClient = {
    async listInstallationRepositories() {
      return [
        {
          id: 101,
          node_id: "R_example",
          name: "pilo",
          full_name: "example/pilo",
          owner: {
            login: "example"
          },
          private: true,
          archived: false,
          default_branch: "main",
          html_url: "https://example.invalid/pilo",
          created_at: "2026-07-01T00:00:00.000Z",
          updated_at: "2026-07-02T00:00:00.000Z",
          pushed_at: "2026-07-02T00:00:00.000Z"
        }
      ];
    }
  };
  const executor = new GithubSyncExecutorService(database, githubAppClient);

  const summary = await executor.runGithubSyncTarget("repositories", {
    currentUserId: "user-id",
    workspaceId: "workspace-id",
    installation: {
      id: "installation-id",
      workspace_id: "workspace-id",
      github_installation_id: 123,
      account_login: "example",
      account_type: "Organization"
    },
    repository: null,
    projectV2: null,
    githubUserAccessToken: null,
    config: {
      appId: "app-id",
      privateKey: "private-key",
      now: () => new Date("2026-07-10T00:00:00.000Z")
    },
    reportProgress: async (progress) => {
      progressUpdates.push(progress);
    }
  });

  assert.deepEqual(
    progressUpdates.map(({ progressPercent, progressStage }) => ({
      progressPercent,
      progressStage
    })),
    [
      {
        progressPercent: 5,
        progressStage: "repositories"
      },
      {
        progressPercent: 95,
        progressStage: "repositories"
      }
    ]
  );
  assert.deepEqual(summary, {
    fetchedCount: 1,
    createdCount: 1,
    updatedCount: 0,
    skippedCount: 0,
    cursor: {}
  });
}

function fullSyncContext(reportProgress) {
  return {
    currentUserId: "user-id",
    workspaceId: "workspace-id",
    installation: {
      id: "installation-id",
      workspace_id: "workspace-id",
      github_installation_id: 123,
      account_login: "example",
      account_type: "Organization"
    },
    repository: null,
    projectV2: null,
    githubUserAccessToken: null,
    config: {
      appId: "app-id",
      privateKey: "private-key",
      now: () => new Date("2026-07-10T00:00:00.000Z")
    },
    reportProgress
  };
}

{
  const progressUpdates = [];
  const database = {
    async query() {
      return [];
    },
    async execute() {
      return {
        rows: [],
        rowCount: 1
      };
    }
  };
  const githubAppClient = {
    async listInstallationRepositories() {
      return [];
    },
    async listProjectV2s() {
      return [];
    }
  };
  const executor = new GithubSyncExecutorService(database, githubAppClient);

  await executor.runGithubSyncTarget(
    "full",
    fullSyncContext(async (progress) => {
      progressUpdates.push({
        progressPercent: progress.progressPercent,
        progressStage: progress.progressStage
      });
    })
  );

  assert.deepEqual(progressUpdates, [
    {
      progressPercent: 5,
      progressStage: "repositories"
    },
    {
      progressPercent: 15,
      progressStage: "project_v2_discovery"
    },
    {
      progressPercent: 25,
      progressStage: "issues"
    },
    {
      progressPercent: 45,
      progressStage: "pull_requests"
    },
    {
      progressPercent: 95,
      progressStage: "finalizing"
    }
  ]);
}

{
  const progressUpdates = [];
  const database = {
    async query() {
      return [];
    },
    async queryOne() {
      return {
        id: "project-v2-id",
        created: true
      };
    },
    async execute() {
      return {
        rows: [],
        rowCount: 1
      };
    }
  };
  const githubAppClient = {
    async listInstallationRepositories() {
      return [];
    },
    async listProjectV2s() {
      return [
        {
          id: "PVT_example",
          databaseId: 1,
          ownerLogin: "example",
          ownerType: "Organization",
          number: 1,
          title: "Example",
          shortDescription: null,
          readme: null,
          url: "https://example.invalid/projects/1",
          resourcePath: "/orgs/example/projects/1",
          public: false,
          closed: false,
          template: false,
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-02T00:00:00.000Z",
          closedAt: null,
          repositoryNodeIds: [],
          raw: {}
        }
      ];
    },
    async listProjectV2Fields() {
      return [];
    },
    async listProjectV2Items() {
      return [];
    }
  };
  const executor = new GithubSyncExecutorService(database, githubAppClient);

  await executor.runGithubSyncTarget(
    "full",
    fullSyncContext(async (progress) => {
      progressUpdates.push({
        progressPercent: progress.progressPercent,
        progressStage: progress.progressStage
      });
    })
  );

  assert.deepEqual(progressUpdates, [
    { progressPercent: 5, progressStage: "repositories" },
    { progressPercent: 15, progressStage: "project_v2_discovery" },
    { progressPercent: 25, progressStage: "issues" },
    { progressPercent: 45, progressStage: "pull_requests" },
    { progressPercent: 65, progressStage: "project_v2_fields" },
    { progressPercent: 75, progressStage: "project_v2_items" },
    { progressPercent: 85, progressStage: "board_hydration" },
    { progressPercent: 95, progressStage: "finalizing" }
  ]);
}

{
  const progressUpdates = [];
  const database = {
    async execute() {
      return {
        rows: [],
        rowCount: 1
      };
    }
  };
  const githubAppClient = {
    async listInstallationRepositories() {
      return [];
    },
    async listProjectV2s() {
      throw new Error("discovery failed");
    }
  };
  const executor = new GithubSyncExecutorService(database, githubAppClient);

  await assert.rejects(
    () =>
      executor.runGithubSyncTarget(
        "full",
        fullSyncContext(async (progress) => {
          progressUpdates.push({
            progressPercent: progress.progressPercent,
            progressStage: progress.progressStage
          });
        })
      ),
    /discovery failed/
  );
  assert.deepEqual(progressUpdates.at(-1), {
    progressPercent: 15,
    progressStage: "project_v2_discovery"
  });
}

{
  const syncRunId = "77777777-7777-4777-8777-777777777777";
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const installationId = "33333333-3333-4333-8333-333333333333";
  const executedQueries = [];
  const summary = {
    fetchedCount: 4,
    createdCount: 1,
    updatedCount: 2,
    skippedCount: 1,
    cursor: {}
  };
  const syncRunRow = (overrides = {}) => ({
    id: syncRunId,
    workspace_id: workspaceId,
    installation_id: installationId,
    repository_id: null,
    project_v2_id: null,
    target: "repositories",
    status: "running",
    started_at: "2026-07-10T00:00:00.000Z",
    finished_at: null,
    fetched_count: 0,
    created_count: 0,
    updated_count: 0,
    skipped_count: 0,
    error_message: null,
    cursor: {},
    ...overrides
  });
  const queryOneRows = [
    {
      id: installationId,
      workspace_id: workspaceId,
      github_installation_id: 123,
      account_login: "example",
      account_type: "Organization"
    },
    syncRunRow(),
    syncRunRow({
      status: "success",
      finished_at: "2026-07-10T00:01:00.000Z",
      fetched_count: 4,
      created_count: 1,
      updated_count: 2,
      skipped_count: 1
    })
  ];
  const database = {
    async queryOne() {
      return queryOneRows.shift() ?? null;
    },
    async execute(text, values) {
      executedQueries.push({ text, values });
      return {
        rows: [],
        rowCount: 1
      };
    }
  };
  const service = new GithubSyncRunService(
    database,
    {
      getGithubAppConfig() {
        return {
          appId: "app-id",
          privateKey: "private-key",
          now: () => new Date("2026-07-10T00:00:00.000Z")
        };
      }
    },
    {
      async assertWorkspaceAccess() {}
    },
    {
      async runGithubSyncTarget(_target, context) {
        await context.reportProgress({
          progressPercent: 45,
          progressStage: "issues",
          summary
        });
        return summary;
      }
    },
    {
      async resolvePersonalProjectV2UserAccessToken() {
        return null;
      }
    }
  );

  const result = await service.startGithubSyncRun("user-id", workspaceId, {
    target: "repositories",
    installationId
  });

  assert.equal(result.status, "success");
  assert.equal(executedQueries.length, 1);
  assert.match(executedQueries[0].text, /UPDATE github_sync_runs/i);
  assert.match(executedQueries[0].text, /jsonb_set/i);
  assert.deepEqual(executedQueries[0].values, [
    syncRunId,
    4,
    1,
    2,
    1,
    JSON.stringify({
      percent: 45,
      stage: "issues"
    })
  ]);
}
