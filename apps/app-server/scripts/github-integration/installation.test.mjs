import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const { GithubIntegrationService } = require("../../dist/modules/github-integration/github-integration.service.js");
const { GithubAppInstallationStateService } = require("../../dist/modules/github-integration/github-app-installation-state.service.js");
const { GithubAppClient } = require("../../dist/modules/github-integration/github-app.client.js");
const { GithubOAuthClient } = require("../../dist/modules/github-integration/github-oauth.client.js");
const { GithubTokenEncryptionService } = require("../../dist/modules/github-integration/github-token-encryption.service.js");
const { GithubSyncJobEnqueueError } = require("../../dist/modules/github-integration/github-sync-job.service.js");

class FakeDatabase {
  constructor({ oneRows = [], rows = [], handlers = {} } = {}) {
    this.oneRows = [...oneRows];
    this.rows = [...rows];
    this.handlers = handlers;
    this.queries = [];
  }

  async queryOne(text, values = []) {
    this.queries.push({ method: "queryOne", text, values });
    if (this.handlers.queryOne) {
      const handled = await this.handlers.queryOne(text, values);
      if (handled !== undefined) {
        return handled;
      }
    }
    return this.oneRows.shift() ?? null;
  }

  async query(text, values = []) {
    this.queries.push({ method: "query", text, values });
    return this.rows.shift() ?? [];
  }

  async execute(text, values = []) {
    this.queries.push({ method: "execute", text, values });
    if (this.handlers.execute) {
      return this.handlers.execute(text, values);
    }
    return undefined;
  }
}

class FakeWorkspaceService {
  constructor() {
    this.accessChecks = [];
    this.ownerChecks = [];
  }

  async assertWorkspaceAccess(currentUserId, workspaceId) {
    this.accessChecks.push({ currentUserId, workspaceId });
    return {
      id: workspaceId,
      name: "Engineering",
      ownerUserId: currentUserId,
      isOwner: true,
      createdAt: "2026-07-04T12:00:00.000Z",
      updatedAt: "2026-07-04T12:00:00.000Z"
    };
  }

  async assertWorkspaceOwnerAccess(currentUserId, workspaceId) {
    this.ownerChecks.push({ currentUserId, workspaceId });
    return {
      id: workspaceId,
      name: "Engineering",
      ownerUserId: currentUserId,
      role: "owner",
      isOwner: true,
      createdAt: "2026-07-04T12:00:00.000Z",
      updatedAt: "2026-07-04T12:00:00.000Z"
    };
  }
}

class FakeGithubSyncRunService {
  constructor({ error = null } = {}) {
    this.error = error;
    this.calls = [];
  }

  async startGithubSyncRun(currentUserId, workspaceId, input) {
    this.calls.push({ currentUserId, workspaceId, input });
    if (this.error) {
      throw this.error;
    }

    return {
      id: "77777777-7777-4777-8777-777777777777",
      target: input.target,
      status: "success",
      installationId: input.installationId
    };
  }
}

const fixedNow = new Date("2026-07-04T12:00:00.000Z");
const workspaceId = "11111111-1111-4111-8111-111111111111";
const currentUserId = "22222222-2222-4222-8222-222222222222";
const baseConfig = {
  clientId: "client-id",
  clientSecret: "client-secret",
  appId: "12345",
  appSlug: "pilo-github-app",
  privateKey: "test-private-key",
  apiPublicOrigin: "https://api.pilo.test",
  apiBasePath: "/api/v1",
  frontendUrl: "https://pilo.test",
  tokenEncryptionKey: "test-token-encryption-key",
  stateSecret: "test-state-secret",
  stateTtlSeconds: 600,
  now: () => fixedNow
};

const configService = {
  getGithubOAuthConfig() {
    return baseConfig;
  },
  getGithubAppConfig() {
    return baseConfig;
  }
};

const tokenEncryption = new GithubTokenEncryptionService();
const encryptedUserToken = tokenEncryption.encryptToken("plain-user-token", baseConfig);
const connectedGithubOAuthRow = {
  github_access_token_encrypted: encryptedUserToken,
  github_connected_at: fixedNow,
  github_revoked_at: null
};

function createService({
  database,
  workspaceService,
  githubOAuthClient,
  githubAppClient,
  githubSyncRunService
} = {}) {
  return new GithubIntegrationService(
    database ?? new FakeDatabase(),
    githubOAuthClient ?? {},
    {},
    tokenEncryption,
    configService,
    workspaceService ?? new FakeWorkspaceService(),
    new GithubAppInstallationStateService(),
    githubAppClient ?? {},
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    githubSyncRunService ?? new FakeGithubSyncRunService()
  );
}

{
  const database = new FakeDatabase({
    oneRows: [connectedGithubOAuthRow]
  });
  const workspaceService = new FakeWorkspaceService();
  const githubOAuthClient = {
    async assertUserInstallationLookupSupported(input) {
      assert.equal(input.accessToken, "plain-user-token");
    }
  };
  const service = createService({ database, workspaceService, githubOAuthClient });

  assert.equal(typeof service.startGithubAppInstallation, "function");

  const start = await service.startGithubAppInstallation(currentUserId, workspaceId, {
    returnUrl: "https://pilo.test/workspaces/11111111-1111-4111-8111-111111111111/github"
  });

  assert.deepEqual(workspaceService.accessChecks, [{ currentUserId, workspaceId }]);
  assert.match(database.queries[0].text, /github_access_token_encrypted/i);
  assert.deepEqual(database.queries[0].values, [currentUserId]);

  const installUrl = new URL(start.installUrl);
  assert.equal(
    installUrl.origin + installUrl.pathname,
    "https://github.com/apps/pilo-github-app/installations/new"
  );
  assert.equal(installUrl.searchParams.get("state"), start.state);
  assert.match(start.stateCookie, /pilo_github_app_installation_state=/);
  assert.match(start.stateCookie, /HttpOnly/);
  assert.match(start.stateCookie, /SameSite=Lax/);
  assert.match(
    database.queries.at(-1).text,
    /INSERT INTO github_callback_states/i
  );

  const statePayload = new GithubAppInstallationStateService().verifyState(
    start.state,
    baseConfig
  );
  assert.equal(statePayload.userId, currentUserId);
  assert.equal(statePayload.workspaceId, workspaceId);
  assert.equal(
    statePayload.returnUrl,
    "https://pilo.test/workspaces/11111111-1111-4111-8111-111111111111/github"
  );
}

{
  const database = new FakeDatabase({
    oneRows: [connectedGithubOAuthRow]
  });
  const githubOAuthClient = {
    async assertUserInstallationLookupSupported(input) {
      assert.equal(input.accessToken, "plain-user-token");
    }
  };
  const service = createService({ database, githubOAuthClient });

  await assert.rejects(
    () =>
      service.startGithubAppInstallation(currentUserId, workspaceId, {
        returnUrl: "https://evil.test/workspaces/11111111-1111-4111-8111-111111111111/github"
      }),
    (error) => error?.response?.error?.message === "Invalid returnUrl"
  );
}

{
  const service = createService({
    database: new FakeDatabase({
      oneRows: [
        {
          github_access_token_encrypted: null,
          github_connected_at: null,
          github_revoked_at: null
        }
      ]
    })
  });

  await assert.rejects(
    () =>
      service.startGithubAppInstallation(currentUserId, workspaceId, {
        returnUrl: "https://pilo.test/github"
      }),
    (error) =>
      error?.response?.error?.message === "GitHub OAuth connection is required"
  );
}

{
  const stateService = new GithubAppInstallationStateService();
  const expiredState = stateService.createState(
    {
      userId: currentUserId,
      workspaceId,
      returnUrl: null
    },
    {
      ...baseConfig,
      stateTtlSeconds: 1
    }
  );

  assert.throws(
    () =>
      stateService.verifyState(expiredState, {
        ...baseConfig,
        now: () => new Date("2026-07-04T12:00:02.000Z"),
        stateTtlSeconds: 1
      }),
    (error) =>
      error?.response?.error?.message ===
      "Invalid GitHub App installation state"
  );
}

{
  const stateService = new GithubAppInstallationStateService();
  const state = stateService.createState(
    {
      userId: currentUserId,
      workspaceId,
      returnUrl: "https://pilo.test/workspaces/11111111-1111-4111-8111-111111111111/github"
    },
    baseConfig
  );
  const statePayload = stateService.verifyState(state, baseConfig);
  const installedAt = new Date("2026-07-04T12:30:00.000Z");
  const suspendedAt = new Date("2026-07-04T12:45:00.000Z");
  const database = new FakeDatabase({
    handlers: {
      queryOne(text) {
        if (/UPDATE github_callback_states/i.test(text)) {
          return {
            user_id: currentUserId,
            workspace_id: workspaceId,
            return_url:
              "https://pilo.test/workspaces/11111111-1111-4111-8111-111111111111/github",
            expires_at: new Date(statePayload.expiresAt)
          };
        }

        if (/SELECT[\s\S]*github_access_token_encrypted[\s\S]*FROM users/i.test(text)) {
          return connectedGithubOAuthRow;
        }

        if (/INSERT INTO github_installations/i.test(text)) {
          return {
            id: "33333333-3333-4333-8333-333333333333",
            workspace_id: workspaceId,
            github_installation_id: "12345678",
            account_login: "my-team",
            account_type: "Organization",
            repository_selection: "selected",
            permissions: {
              metadata: "read",
              contents: "read",
              issues: "read"
            },
            installed_by_user_id: currentUserId,
            installed_at: installedAt,
            suspended_at: suspendedAt,
            last_synced_at: null
          };
        }

        return undefined;
      }
    }
  });
  const githubOAuthClient = {
    async hasUserInstallationAccess(input) {
      assert.equal(input.accessToken, "plain-user-token");
      assert.equal(input.installationId, 12345678);
      return true;
    }
  };
  const githubAppClient = {
    async getInstallation(input) {
      assert.equal(input.installationId, 12345678);
      assert.equal(input.appId, "12345");
      assert.equal(input.privateKey, "test-private-key");
      return {
        githubInstallationId: 12345678,
        accountLogin: "my-team",
        accountType: "Organization",
        repositorySelection: "selected",
        permissions: {
          metadata: "read",
          contents: "read",
          issues: "read"
        },
        installedAt: "2026-07-04T12:30:00.000Z",
        suspendedAt: "2026-07-04T12:45:00.000Z"
      };
    }
  };
  const githubSyncRunService = new FakeGithubSyncRunService();
  const service = createService({
    database,
    githubOAuthClient,
    githubAppClient,
    githubSyncRunService
  });

  assert.equal(typeof service.completeGithubAppInstallationCallback, "function");

  const callback = await service.completeGithubAppInstallationCallback({
    installation_id: "12345678",
    setup_action: "install",
    state
  }, "pilo_github_app_installation_state=installation-binding-token");

  assert.deepEqual(callback, {
    workspaceId,
    installationId: "33333333-3333-4333-8333-333333333333",
    githubInstallationId: 12345678,
    accountLogin: "my-team",
    accountType: "Organization",
    repositorySelection: "selected",
    permissions: {
      metadata: "read",
      contents: "read",
      issues: "read"
    },
    installedByUserId: currentUserId,
    installedAt: "2026-07-04T12:30:00.000Z",
    suspendedAt: "2026-07-04T12:45:00.000Z",
    lastSyncedAt: null,
    syncRunId: "77777777-7777-4777-8777-777777777777",
    returnUrl: "https://pilo.test/workspaces/11111111-1111-4111-8111-111111111111/github?github_installation_id=33333333-3333-4333-8333-333333333333"
  });

  const upsert = database.queries.at(-1);
  assert.match(upsert.text, /INSERT INTO github_installations/i);
  assert.match(
    upsert.text,
    /ON CONFLICT \(workspace_id, github_installation_id\)/i
  );
  assert.doesNotMatch(upsert.text, /token|private_key|secret/i);
  assert.deepEqual(upsert.values, [
    workspaceId,
    12345678,
    "my-team",
    "Organization",
    "selected",
    {
      metadata: "read",
      contents: "read",
      issues: "read"
    },
    currentUserId,
    "2026-07-04T12:30:00.000Z",
    "2026-07-04T12:45:00.000Z"
  ]);
  assert.deepEqual(githubSyncRunService.calls, [{
    currentUserId,
    workspaceId,
    input: {
      installationId: "33333333-3333-4333-8333-333333333333",
      target: "source"
    }
  }]);
}

{
  const stateService = new GithubAppInstallationStateService();
  const state = stateService.createState(
    {
      userId: currentUserId,
      workspaceId,
      returnUrl: null
    },
    baseConfig
  );
  let stateConsumeCount = 0;
  const database = new FakeDatabase({
    handlers: {
      queryOne(text) {
        if (/UPDATE github_callback_states/i.test(text)) {
          stateConsumeCount += 1;
          if (stateConsumeCount > 1) {
            return null;
          }

          return {
            user_id: currentUserId,
            workspace_id: workspaceId,
            return_url: null,
            expires_at: fixedNow
          };
        }

        if (/SELECT[\s\S]*github_access_token_encrypted[\s\S]*FROM users/i.test(text)) {
          return connectedGithubOAuthRow;
        }

        if (/INSERT INTO github_installations/i.test(text)) {
          return {
            id: "33333333-3333-4333-8333-333333333333",
            workspace_id: workspaceId,
            github_installation_id: "12345678",
            account_login: "my-team",
            account_type: "Organization",
            repository_selection: "selected",
            permissions: {
              metadata: "read"
            },
            installed_by_user_id: currentUserId,
            installed_at: null,
            suspended_at: null,
            last_synced_at: null
          };
        }

        return undefined;
      }
    }
  });
  const service = createService({
    database,
    githubOAuthClient: {
      async hasUserInstallationAccess() {
        return true;
      }
    },
    githubAppClient: {
      async getInstallation() {
        return {
          githubInstallationId: 12345678,
          accountLogin: "my-team",
          accountType: "Organization",
          repositorySelection: "selected",
          permissions: {
            metadata: "read"
          },
          installedAt: null,
          suspendedAt: null
        };
      }
    }
  });

  await service.completeGithubAppInstallationCallback(
    {
      installation_id: "12345678",
      setup_action: "install",
      state
    },
    "pilo_github_app_installation_state=installation-binding-token"
  );

  await assert.rejects(
    () =>
      service.completeGithubAppInstallationCallback(
        {
          installation_id: "12345678",
          setup_action: "install",
          state
        },
        "pilo_github_app_installation_state=installation-binding-token"
      ),
    (error) =>
      error?.response?.error?.message === "Invalid GitHub App installation state"
  );
}

{
  const stateService = new GithubAppInstallationStateService();
  const state = stateService.createState(
    {
      userId: currentUserId,
      workspaceId,
      returnUrl: null
    },
    baseConfig
  );
  const statePayload = stateService.verifyState(state, baseConfig);
  const database = new FakeDatabase({
    handlers: {
      queryOne(text) {
        if (/UPDATE github_callback_states/i.test(text)) {
          return {
            user_id: currentUserId,
            workspace_id: workspaceId,
            return_url: null,
            expires_at: new Date(statePayload.expiresAt)
          };
        }

        if (/SELECT[\s\S]*github_access_token_encrypted[\s\S]*FROM users/i.test(text)) {
          return connectedGithubOAuthRow;
        }

        if (/INSERT INTO github_installations/i.test(text)) {
          return {
            id: "33333333-3333-4333-8333-333333333333",
            workspace_id: workspaceId,
            github_installation_id: "12345678",
            account_login: "my-team",
            account_type: "Organization",
            repository_selection: "selected",
            permissions: {
              metadata: "read"
            },
            installed_by_user_id: currentUserId,
            installed_at: null,
            suspended_at: null,
            last_synced_at: null
          };
        }

        return undefined;
      }
    }
  });
  const githubSyncRunService = new FakeGithubSyncRunService({
    error: new GithubSyncJobEnqueueError("88888888-8888-4888-8888-888888888888")
  });
  const service = createService({
    database,
    githubOAuthClient: {
      async hasUserInstallationAccess() {
        return true;
      }
    },
    githubAppClient: {
      async getInstallation() {
        return {
          githubInstallationId: 12345678,
          accountLogin: "my-team",
          accountType: "Organization",
          repositorySelection: "selected",
          permissions: {
            metadata: "read"
          },
          installedAt: null,
          suspendedAt: null
        };
      }
    },
    githubSyncRunService
  });

  await assert.doesNotReject(
    () => service.completeGithubAppInstallationCallback(
      {
        installation_id: "12345678",
        setup_action: "install",
        state
      },
      "pilo_github_app_installation_state=installation-binding-token"
    )
  );
  assert.deepEqual(githubSyncRunService.calls, [{
    currentUserId,
    workspaceId,
    input: {
      installationId: "33333333-3333-4333-8333-333333333333",
      target: "source"
    }
  }]);
}

{
  const stateService = new GithubAppInstallationStateService();
  const state = stateService.createState(
    {
      userId: currentUserId,
      workspaceId,
      returnUrl: null
    },
    baseConfig
  );
  let installationAccessChecked = false;
  const service = createService({
    database: new FakeDatabase(),
    githubOAuthClient: {
      async hasUserInstallationAccess() {
        installationAccessChecked = true;
        throw new Error("installation lookup should not run without a state cookie");
      }
    }
  });

  await assert.rejects(
    () =>
      service.completeGithubAppInstallationCallback(
        {
          installation_id: "12345678",
          setup_action: "install",
          state
        },
        null
      ),
    (error) =>
      error?.response?.error?.message === "Invalid GitHub App installation state"
  );
  assert.equal(installationAccessChecked, false);
}

{
  const stateService = new GithubAppInstallationStateService();
  const state = stateService.createState(
    {
      userId: currentUserId,
      workspaceId,
      returnUrl:
        "https://pilo.test/workspaces/11111111-1111-4111-8111-111111111111/github"
    },
    baseConfig
  );
  const statePayload = stateService.verifyState(state, baseConfig);
  const database = new FakeDatabase({
    handlers: {
      queryOne(text) {
        if (/UPDATE github_callback_states/i.test(text)) {
          return {
            user_id: currentUserId,
            workspace_id: workspaceId,
            return_url:
              "https://pilo.test/workspaces/11111111-1111-4111-8111-111111111111/github",
            expires_at: new Date(statePayload.expiresAt)
          };
        }

        if (/SELECT[\s\S]*github_access_token_encrypted[\s\S]*FROM users/i.test(text)) {
          return connectedGithubOAuthRow;
        }

        return undefined;
      }
    }
  });
  let appLookupCalled = false;
  const service = createService({
    database,
    githubOAuthClient: {
      async hasUserInstallationAccess(input) {
        assert.equal(input.accessToken, "plain-user-token");
        assert.equal(input.installationId, 12345678);
        return false;
      }
    },
    githubAppClient: {
      async getInstallation() {
        appLookupCalled = true;
        throw new Error("should not call app lookup");
      }
    }
  });

  await assert.rejects(
    () =>
      service.completeGithubAppInstallationCallback({
        installation_id: "12345678",
        setup_action: "install",
        state
      }, "pilo_github_app_installation_state=installation-binding-token"),
    (error) =>
      error?.returnUrl ===
        "https://pilo.test/workspaces/11111111-1111-4111-8111-111111111111/github" &&
      error?.callbackError === "installation_not_accessible" &&
      error?.response?.error?.message ===
        "GitHub App installation is not accessible to the connected GitHub user"
  );
  assert.equal(appLookupCalled, false);
}

{
  const stateService = new GithubAppInstallationStateService();
  const state = stateService.createState(
    {
      userId: currentUserId,
      workspaceId,
      returnUrl: null
    },
    baseConfig
  );
  const statePayload = stateService.verifyState(state, baseConfig);
  const database = new FakeDatabase({
    handlers: {
      queryOne(text) {
        if (/UPDATE github_callback_states/i.test(text)) {
          return {
            user_id: currentUserId,
            workspace_id: workspaceId,
            return_url: null,
            expires_at: new Date(statePayload.expiresAt)
          };
        }

        if (/SELECT[\s\S]*github_access_token_encrypted[\s\S]*FROM users/i.test(text)) {
          return connectedGithubOAuthRow;
        }

        return undefined;
      }
    }
  });
  let appLookupCalled = false;
  const service = createService({
    database,
    githubOAuthClient: {
      async hasUserInstallationAccess(input) {
        assert.equal(input.accessToken, "plain-user-token");
        assert.equal(input.installationId, 12345678);
        return false;
      }
    },
    githubAppClient: {
      async getInstallation() {
        appLookupCalled = true;
        throw new Error("should not call app lookup");
      }
    }
  });

  await assert.rejects(
    () =>
      service.completeGithubAppInstallationCallback({
        installation_id: "12345678",
        setup_action: "install",
        state
      }, "pilo_github_app_installation_state=installation-binding-token"),
    (error) =>
      error?.response?.error?.message ===
      "GitHub App installation is not accessible to the connected GitHub user"
  );
  assert.equal(appLookupCalled, false);
}

{
  const database = new FakeDatabase({
    rows: [
      [
        {
          id: "33333333-3333-4333-8333-333333333333",
          workspace_id: workspaceId,
          github_installation_id: "12345678",
          account_login: "my-team",
          account_type: "Organization",
          repository_selection: "selected",
          permissions: {
            metadata: "read",
            contents: "read"
          },
          installed_by_user_id: currentUserId,
          installed_at: "2026-07-04T12:30:00.000Z",
          suspended_at: null,
          last_synced_at: "2026-07-04T12:40:00.000Z"
        }
      ]
    ]
  });
  const workspaceService = new FakeWorkspaceService();
  const service = createService({ database, workspaceService });

  assert.equal(typeof service.listGithubAppInstallations, "function");

  const installations = await service.listGithubAppInstallations(
    currentUserId,
    workspaceId
  );

  assert.deepEqual(workspaceService.accessChecks, [{ currentUserId, workspaceId }]);
  assert.deepEqual(installations, [
    {
      id: "33333333-3333-4333-8333-333333333333",
      workspaceId,
      githubInstallationId: 12345678,
      accountLogin: "my-team",
      accountType: "Organization",
      repositorySelection: "selected",
      permissions: {
        metadata: "read",
        contents: "read"
      },
      installedByUserId: currentUserId,
      installedAt: "2026-07-04T12:30:00.000Z",
      suspendedAt: null,
      lastSyncedAt: "2026-07-04T12:40:00.000Z"
    }
  ]);
  assert.match(database.queries[0].text, /FROM github_installations/i);
  assert.doesNotMatch(database.queries[0].text, /token|private_key|secret/i);
}

{
  const installationId = "33333333-3333-4333-8333-333333333333";
  const database = new FakeDatabase({
    handlers: {
      queryOne(text, values) {
        if (/DELETE FROM github_installations/i.test(text)) {
          assert.match(text, /workspace_id = \$1/i);
          assert.match(text, /id = \$2/i);
          assert.deepEqual(values, [workspaceId, installationId]);
          return { id: installationId };
        }

        if (/FROM github_installations/i.test(text)) {
          assert.match(text, /workspace_id = \$1/i);
          assert.match(text, /id = \$2/i);
          assert.deepEqual(values, [workspaceId, installationId]);
          return {
            id: installationId,
            workspace_id: workspaceId,
            github_installation_id: "12345678",
            account_login: "my-team",
            account_type: "Organization",
            repository_selection: "selected",
            permissions: {
              metadata: "read"
            },
            installed_by_user_id: currentUserId,
            installed_at: "2026-07-04T12:30:00.000Z",
            suspended_at: null,
            last_synced_at: "2026-07-04T12:40:00.000Z"
          };
        }

        return undefined;
      }
    }
  });
  const workspaceService = new FakeWorkspaceService();
  const githubAppClient = {
    calls: [],
    async deleteInstallation(input) {
      this.calls.push(input);
      return {
        deleted: true,
        alreadyDeleted: false
      };
    }
  };
  const service = createService({ database, workspaceService, githubAppClient });

  assert.equal(typeof service.deleteGithubAppInstallation, "function");

  const result = await service.deleteGithubAppInstallation(
    currentUserId,
    workspaceId,
    installationId
  );

  assert.deepEqual(workspaceService.ownerChecks, [{ currentUserId, workspaceId }]);
  assert.deepEqual(githubAppClient.calls, [
    {
      installationId: 12345678,
      appId: "12345",
      privateKey: "test-private-key",
      now: baseConfig.now
    }
  ]);
  assert.deepEqual(result, {
    deleted: true,
    alreadyDeleted: false,
    installationId,
    githubInstallationId: 12345678,
    accountLogin: "my-team"
  });
  assert.match(database.queries.at(-1).text, /DELETE FROM github_installations/i);
  for (const query of database.queries) {
    assert.doesNotMatch(query.text, /token|private_key|secret/i);
  }
}

{
  const installationId = "33333333-3333-4333-8333-333333333333";
  let localDeleteCalled = false;
  const database = new FakeDatabase({
    handlers: {
      queryOne(text) {
        if (/DELETE FROM github_installations/i.test(text)) {
          localDeleteCalled = true;
          return { id: installationId };
        }

        if (/FROM github_installations/i.test(text)) {
          return {
            id: installationId,
            workspace_id: workspaceId,
            github_installation_id: "12345678",
            account_login: "my-team",
            account_type: "Organization",
            repository_selection: "selected",
            permissions: {},
            installed_by_user_id: currentUserId,
            installed_at: null,
            suspended_at: null,
            last_synced_at: null
          };
        }

        return undefined;
      }
    }
  });
  const service = createService({
    database,
    githubAppClient: {
      async deleteInstallation() {
        return {
          deleted: true,
          alreadyDeleted: true
        };
      }
    }
  });

  const result = await service.deleteGithubAppInstallation(
    currentUserId,
    workspaceId,
    installationId
  );

  assert.equal(localDeleteCalled, true);
  assert.equal(result.alreadyDeleted, true);
}

{
  const installationId = "33333333-3333-4333-8333-333333333333";
  const service = createService({
    database: new FakeDatabase({
      handlers: {
        queryOne(text) {
          if (/FROM github_installations/i.test(text)) {
            return null;
          }

          throw new Error("unexpected query");
        }
      }
    })
  });

  await assert.rejects(
    () =>
      service.deleteGithubAppInstallation(
        currentUserId,
        workspaceId,
        installationId
      ),
    (error) => {
      assert.equal(error.getStatus(), 404);
      assert.equal(
        error.getResponse().error.message,
        "GitHub App installation not found"
      );
      return true;
    }
  );
}

{
  const installationId = "33333333-3333-4333-8333-333333333333";
  let localDeleteCalled = false;
  const service = createService({
    database: new FakeDatabase({
      handlers: {
        queryOne(text) {
          if (/FROM github_installations/i.test(text)) {
            return {
              id: installationId,
              workspace_id: workspaceId,
              github_installation_id: "12345678",
              account_login: "my-team",
              account_type: "Organization",
              repository_selection: "selected",
              permissions: {},
              installed_by_user_id: currentUserId,
              installed_at: null,
              suspended_at: null,
              last_synced_at: null
            };
          }

          if (/DELETE FROM github_installations/i.test(text)) {
            localDeleteCalled = true;
          }

          return undefined;
        }
      }
    }),
    githubAppClient: {
      async deleteInstallation() {
        throw new Error("provider failure");
      }
    }
  });

  await assert.rejects(
    () =>
      service.deleteGithubAppInstallation(
        currentUserId,
        workspaceId,
        installationId
      ),
    /provider failure/
  );
  assert.equal(localDeleteCalled, false);
}

{
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048
  });
  const privateKeyPem = privateKey.export({
    type: "pkcs8",
    format: "pem"
  });
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestHeaders = {};
  globalThis.fetch = async (url, options) => {
    requestUrl = url.toString();
    requestHeaders = options?.headers ?? {};
    return {
      ok: true,
      async json() {
        return {
          id: 12345678,
          account: {
            login: "my-team",
            type: "Organization"
          },
          repository_selection: "selected",
          permissions: {
            metadata: "read"
          },
          created_at: "2026-07-04T12:30:00.000Z",
          suspended_at: "2026-07-04T12:45:00.000Z"
        };
      }
    };
  };

  try {
    const installation = await new GithubAppClient().getInstallation({
      installationId: 12345678,
      appId: "12345",
      privateKey: privateKeyPem,
      now: () => fixedNow
    });

    assert.equal(
      requestUrl,
      "https://api.github.com/app/installations/12345678"
    );
    assert.match(requestHeaders.Authorization, /^Bearer [^.]+\.[^.]+\.[^.]+$/);
    assert.equal(requestHeaders["X-GitHub-Api-Version"], "2026-03-10");
    assert.deepEqual(installation, {
      githubInstallationId: 12345678,
      accountLogin: "my-team",
      accountType: "Organization",
      repositorySelection: "selected",
      permissions: {
        metadata: "read"
      },
      installedAt: "2026-07-04T12:30:00.000Z",
      suspendedAt: "2026-07-04T12:45:00.000Z"
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestHeaders = {};
  globalThis.fetch = async (url, options) => {
    requestUrl = url.toString();
    requestHeaders = options?.headers ?? {};
    return {
      ok: true,
      async json() {
        return {
          total_count: 1,
          installations: [
            {
              id: 12345678
            }
          ]
        };
      }
    };
  };

  try {
    const hasAccess = await new GithubOAuthClient().hasUserInstallationAccess({
      accessToken: "plain-user-token",
      installationId: 12345678
    });

    assert.equal(hasAccess, true);
    assert.equal(
      requestUrl,
      "https://api.github.com/user/installations?per_page=100&page=1"
    );
    assert.equal(requestHeaders.Authorization, "Bearer plain-user-token");
    assert.equal(requestHeaders["X-GitHub-Api-Version"], "2026-03-10");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  await assert.rejects(
    () =>
      new GithubAppClient().getInstallation({
        installationId: 12345678,
        appId: "12345",
        privateKey: "invalid-private-key",
        now: () => fixedNow
      }),
    (error) => error?.response?.error?.message === "GitHub App is not configured"
  );
}

{
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048
  });
  const privateKeyPem = privateKey.export({
    type: "pkcs8",
    format: "pem"
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("provider raw error should not leak");
  };

  try {
    await assert.rejects(
      () =>
        new GithubAppClient().getInstallation({
          installationId: 12345678,
          appId: "12345",
          privateKey: privateKeyPem,
          now: () => fixedNow
        }),
      (error) =>
        error?.response?.error?.message ===
        "GitHub App installation lookup failed"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}
