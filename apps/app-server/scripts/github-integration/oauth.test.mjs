import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const { GithubIntegrationService } = require("../../dist/modules/github-integration/github-integration.service.js");
const { GithubOAuthIntegrationService } = require("../../dist/modules/github-integration/github-oauth-integration.service.js");
const { GithubProjectOAuthIntegrationService } = require("../../dist/modules/github-integration/github-project-oauth-integration.service.js");
const { GithubOAuthConnectionService } = require("../../dist/modules/github-integration/github-oauth-connection.service.js");
const { GithubOAuthStateService } = require("../../dist/modules/github-integration/github-oauth-state.service.js");
const { GithubTokenEncryptionService } = require("../../dist/modules/github-integration/github-token-encryption.service.js");

class FakeDatabase {
  constructor(rows = [], handlers = {}) {
    this.rows = [...rows];
    this.handlers = handlers;
    this.queries = [];
  }

  async queryOne(text, values = []) {
    this.queries.push({ text, values });
    if (this.handlers.queryOne) {
      const handled = await this.handlers.queryOne(text, values);
      if (handled !== undefined) {
        return handled;
      }
    }
    return this.rows.shift() ?? null;
  }

  async query(text, values = []) {
    this.queries.push({ text, values });
    if (this.handlers.query) {
      return this.handlers.query(text, values);
    }
    return [];
  }

  async transaction(callback) {
    return callback(this);
  }

  async execute(text, values = []) {
    this.queries.push({ text, values });
    if (this.handlers.execute) {
      return this.handlers.execute(text, values);
    }
    return undefined;
  }
}

const fixedNow = new Date("2026-07-04T12:00:00.000Z");
const baseConfig = {
  clientId: "client-id",
  clientSecret: "client-secret",
  apiPublicOrigin: "https://api.pilo.test",
  apiBasePath: "/api/v1",
  frontendUrl: "https://pilo.test",
  tokenEncryptionKey: "test-token-encryption-key",
  stateSecret: "test-state-secret",
  stateTtlSeconds: 600,
  now: () => fixedNow
};
const projectOAuthConfig = {
  ...baseConfig,
  clientId: "project-client-id",
  clientSecret: "project-client-secret"
};

const stateService = new GithubOAuthStateService();
const tokenEncryption = new GithubTokenEncryptionService();
const configService = {
  getGithubOAuthConfig() {
    return baseConfig;
  },
  getGithubProjectOAuthConfig() {
    return projectOAuthConfig;
  }
};

const connectedRow = {
  github_user_id: "12345678",
  github_login: "juhyeong",
  access_token_encrypted: tokenEncryption.encryptToken("plain-access-token", baseConfig),
  token_scope: "",
  connected_at: fixedNow,
  revoked_at: null
};
const projectOAuthConnectedRow = {
  github_user_id: "12345678",
  github_login: "juhyeong",
  access_token_encrypted: tokenEncryption.encryptToken("project-access-token", projectOAuthConfig),
  token_scope: "read:user,user:email,project",
  connected_at: fixedNow,
  revoked_at: null
};

{
  const encrypted = tokenEncryption.encryptToken("plain-access-token", baseConfig);

  assert.match(encrypted, /^v1:/);
  assert.equal(
    tokenEncryption.decryptToken(encrypted, baseConfig),
    "plain-access-token"
  );
}

{
  assert.throws(
    () => tokenEncryption.decryptToken("not-a-valid-token", baseConfig),
    (error) =>
      error?.response?.error?.message === "GitHub OAuth connection is invalid"
  );
}

{
  const database = new FakeDatabase([connectedRow]);
  const service = new GithubIntegrationService(
    database,
    {},
    stateService,
    tokenEncryption,
    configService
  );

  const status = await service.getGithubOAuthStatus("user-1");

  assert.deepEqual(status, {
    connected: true,
    githubUserId: 12345678,
    githubLogin: "juhyeong",
    tokenScope: "",
    githubConnectedAt: "2026-07-04T12:00:00.000Z",
    githubRevokedAt: null
  });
  assert.doesNotMatch(database.queries[0].text, /github_access_token_encrypted/i);
}

{
  const service = new GithubOAuthIntegrationService(
    {}, {}, {}, {}, {}, {},
    {
      async getOptionalActiveConnection() {
        return null;
      },
      async getStatus() {
        return {
          github_user_id: "12345678",
          github_login: "juhyeong",
          access_token_encrypted: null,
          token_scope: null,
          connected_at: fixedNow,
          revoked_at: fixedNow
        };
      }
    }
  );

  const status = await service.getGithubOAuthStatus("user-1");

  assert.deepEqual(status, {
    connected: false,
    githubUserId: 12345678,
    githubLogin: "juhyeong",
    tokenScope: null,
    githubConnectedAt: "2026-07-04T12:00:00.000Z",
    githubRevokedAt: "2026-07-04T12:00:00.000Z"
  });
}

{
  const database = new FakeDatabase();
  const service = new GithubIntegrationService(
    database,
    {},
    stateService,
    tokenEncryption,
    configService
  );

  const start = await service.startGithubOAuth("user-1", {
    returnUrl: "https://pilo.test/settings/integrations/github"
  });
  const authorizeUrl = new URL(start.authorizeUrl);

  assert.equal(authorizeUrl.origin + authorizeUrl.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(authorizeUrl.searchParams.get("client_id"), "client-id");
  assert.equal(authorizeUrl.searchParams.get("redirect_uri"), "https://api.pilo.test/api/v1/github/oauth/callback");
  assert.equal(authorizeUrl.searchParams.get("scope"), null);
  assert.equal(authorizeUrl.searchParams.get("state"), start.state);
  assert.match(start.stateCookie, /pilo_github_oauth_state=/);
  assert.match(start.stateCookie, /HttpOnly/);
  assert.match(start.stateCookie, /SameSite=Lax/);
  assert.match(
    database.queries[0].text,
    /INSERT INTO github_callback_states/i
  );

  const parsedState = stateService.verifyState(start.state, baseConfig);
  assert.equal(parsedState.userId, "user-1");
  assert.equal(parsedState.returnUrl, "https://pilo.test/settings/integrations/github");

  const startWithoutBody = await service.startGithubOAuth("user-1", undefined);
  const stateWithoutBody = stateService.verifyState(startWithoutBody.state, baseConfig);
  assert.equal(stateWithoutBody.returnUrl, null);

  await assert.rejects(
    () =>
      service.startGithubOAuth("user-1", {
        returnUrl: "https://evil.test/settings/integrations/github"
      }),
    (error) => error?.response?.error?.message === "Invalid returnUrl"
  );
}

{
  const database = new FakeDatabase([projectOAuthConnectedRow]);
  const service = new GithubIntegrationService(
    database,
    {},
    stateService,
    tokenEncryption,
    configService
  );

  const status = await service.getGithubProjectOAuthStatus("user-1");

  assert.deepEqual(status, {
    connected: true,
    githubUserId: 12345678,
    githubLogin: "juhyeong",
    tokenScope: "read:user,user:email,project",
    githubConnectedAt: "2026-07-04T12:00:00.000Z",
    githubRevokedAt: null
  });
  assert.doesNotMatch(
    database.queries[0].text,
    /github_project_access_token_encrypted/i
  );
}

{
  const service = new GithubProjectOAuthIntegrationService(
    {}, {}, {}, {}, {}, {},
    {
      async getOptionalActiveConnection() {
        return null;
      },
      async getStatus() {
        return {
          github_user_id: "12345678",
          github_login: "juhyeong",
          access_token_encrypted: null,
          token_scope: "read:user,user:email,project",
          connected_at: fixedNow,
          revoked_at: fixedNow
        };
      }
    }
  );

  const status = await service.getGithubProjectOAuthStatus("user-1");

  assert.deepEqual(status, {
    connected: false,
    githubUserId: 12345678,
    githubLogin: "juhyeong",
    tokenScope: null,
    githubConnectedAt: "2026-07-04T12:00:00.000Z",
    githubRevokedAt: "2026-07-04T12:00:00.000Z"
  });
}

{
  const database = new FakeDatabase();
  const service = new GithubIntegrationService(
    database,
    {},
    stateService,
    tokenEncryption,
    configService
  );

  const start = await service.startGithubProjectOAuth("user-1", {
    returnUrl: "https://pilo.test/settings/integrations/github"
  });
  const authorizeUrl = new URL(start.authorizeUrl);

  assert.equal(
    authorizeUrl.origin + authorizeUrl.pathname,
    "https://github.com/login/oauth/authorize"
  );
  assert.equal(authorizeUrl.searchParams.get("client_id"), "project-client-id");
  assert.equal(
    authorizeUrl.searchParams.get("redirect_uri"),
    "https://api.pilo.test/api/v1/github/project-oauth/callback"
  );
  assert.equal(
    authorizeUrl.searchParams.get("scope"),
    "read:user user:email project"
  );
  assert.equal(authorizeUrl.searchParams.get("state"), start.state);
  assert.match(start.stateCookie, /pilo_github_project_oauth_state=/);
  assert.match(start.stateCookie, /HttpOnly/);
  assert.match(start.stateCookie, /SameSite=Lax/);
  assert.match(database.queries[0].text, /flow,\s*state_nonce/i);
}

{
  const state = stateService.createState(
    {
      userId: "user-1",
      returnUrl: "https://pilo.test/settings/integrations/github"
    },
    projectOAuthConfig
  );
  const statePayload = stateService.verifyState(state, projectOAuthConfig);
  const database = new FakeDatabase([], {
    queryOne(text) {
      if (/UPDATE github_callback_states/i.test(text)) {
        return {
          user_id: "user-1",
          workspace_id: null,
          return_url: "https://pilo.test/settings/integrations/github",
          expires_at: new Date(statePayload.expiresAt)
        };
      }

      if (/FROM github_oauth_connections/i.test(text)) {
        return connectedRow;
      }

      if (/INSERT INTO github_oauth_connections/i.test(text)) {
        return projectOAuthConnectedRow;
      }

      return undefined;
    }
  });
  const githubClient = {
    async exchangeCodeForAccessToken(input) {
      assert.equal(input.code, "project-oauth-code");
      assert.equal(
        input.redirectUri,
        "https://api.pilo.test/api/v1/github/project-oauth/callback"
      );
      return {
        accessToken: "plain-project-access-token",
        scope: "read:user,user:email,project"
      };
    },
    async getAuthenticatedUser(accessToken) {
      assert.equal(accessToken, "plain-project-access-token");
      return {
        id: 12345678,
        login: "juhyeong"
      };
    }
  };
  const service = new GithubIntegrationService(
    database,
    githubClient,
    stateService,
    tokenEncryption,
    configService
  );

  const callback = await service.completeGithubProjectOAuthCallback(
    {
      code: "project-oauth-code",
      state
    },
    "pilo_github_project_oauth_state=project-binding-token"
  );

  assert.deepEqual(callback, {
    connected: true,
    githubUserId: 12345678,
    githubLogin: "juhyeong",
    tokenScope: "read:user,user:email,project",
    githubConnectedAt: "2026-07-04T12:00:00.000Z",
    returnUrl: "https://pilo.test/settings/integrations/github"
  });

  const update = database.queries.at(-1);
  assert.match(update.text, /INSERT INTO github_oauth_connections/i);
  assert.equal(update.values[0], "user-1");
  assert.equal(update.values[1], "project_v2");
  assert.equal(update.values[2], 12345678);
  assert.equal(update.values[3], "juhyeong");
  assert.notEqual(update.values[4], "plain-project-access-token");
  assert.match(update.values[4], /^v1:/);
}

{
  const state = stateService.createState(
    {
      userId: "user-1",
      returnUrl: null
    },
    projectOAuthConfig
  );
  const statePayload = stateService.verifyState(state, projectOAuthConfig);
  const database = new FakeDatabase([], {
    queryOne(text) {
      if (/UPDATE github_callback_states/i.test(text)) {
        return {
          user_id: "user-1",
          workspace_id: null,
          return_url: null,
          expires_at: new Date(statePayload.expiresAt)
        };
      }

      return undefined;
    }
  });
  const service = new GithubIntegrationService(
    database,
    {
      async exchangeCodeForAccessToken() {
        return {
          accessToken: "plain-project-access-token",
          scope: "read:user,user:email"
        };
      },
      async getAuthenticatedUser() {
        return {
          id: 12345678,
          login: "juhyeong"
        };
      }
    },
    stateService,
    tokenEncryption,
    configService
  );

  await assert.rejects(
    () =>
      service.completeGithubProjectOAuthCallback(
        {
          code: "project-oauth-code",
          state
        },
        "pilo_github_project_oauth_state=project-binding-token"
      ),
    (error) =>
      error?.response?.error?.message ===
      "GitHub ProjectV2 OAuth connection must be reconnected with project scope"
  );
}

{
  const state = stateService.createState(
    {
      userId: "user-1",
      returnUrl: "https://pilo.test/settings/integrations/github"
    },
    projectOAuthConfig
  );
  const statePayload = stateService.verifyState(state, projectOAuthConfig);
  const database = new FakeDatabase([], {
    queryOne(text) {
      if (/UPDATE github_callback_states/i.test(text)) {
        return {
          user_id: "user-1",
          workspace_id: null,
          return_url: "https://pilo.test/settings/integrations/github",
          expires_at: new Date(statePayload.expiresAt)
        };
      }

      return undefined;
    }
  });
  const service = new GithubIntegrationService(
    database,
    {
      async exchangeCodeForAccessToken() {
        return {
          accessToken: "plain-project-access-token",
          scope: "read:user,user:email"
        };
      }
    },
    stateService,
    tokenEncryption,
    configService
  );

  await assert.rejects(
    () =>
      service.completeGithubProjectOAuthCallback(
        {
          code: "project-oauth-code",
          state
        },
        "pilo_github_project_oauth_state=project-binding-token"
      ),
    (error) =>
      error?.returnUrl === "https://pilo.test/settings/integrations/github" &&
      error?.callbackError === "project_oauth_scope_missing" &&
      error?.response?.error?.message ===
        "GitHub ProjectV2 OAuth connection must be reconnected with project scope"
  );
}

{
  const database = new FakeDatabase([], {
    queryOne(text) {
      if (/SELECT id FROM users WHERE id <> \$1 AND github_user_id = \$2/i.test(text)) {
        return { id: "another-user" };
      }
      return undefined;
    }
  });
  const service = new GithubOAuthConnectionService(database, tokenEncryption, configService);

  await assert.rejects(
    () => service.saveConnection({
      userId: "user-1",
      purpose: "app_user",
      githubUserId: 12345678,
      githubLogin: "juhyeong",
      encryptedToken: connectedRow.access_token_encrypted,
      tokenScope: null
    }),
    (error) => error?.response?.error?.message === "GitHub account is already connected to another PILO account"
  );
  assert.equal(database.queries.some(({ text }) => /INSERT INTO github_oauth_connections/i.test(text)), false);
}

{
  const database = new FakeDatabase();
  const service = new GithubOAuthConnectionService(database, tokenEncryption, configService);

  await service.disconnectMismatchedConnectionsInTransaction(database, "user-1", 87654321);

  assert.match(database.queries[0].text, /UPDATE github_oauth_connections/i);
  assert.match(database.queries[1].text, /UPDATE users SET/i);
  assert.match(database.queries[1].text, /github_user_id IS DISTINCT FROM \$2/i);
  assert.match(database.queries[1].text, /github_project_access_token_encrypted = CASE/i);
}

{
  const database = new FakeDatabase([{ id: "user-1" }]);
  const service = new GithubIntegrationService(
    database,
    {},
    stateService,
    tokenEncryption,
    configService
  );

  const result = await service.disconnectGithubProjectOAuth("user-1");

  assert.deepEqual(result, { disconnected: true });
  assert.match(
    database.queries[1].text,
    /UPDATE github_oauth_connections/i
  );
  assert.match(database.queries[1].text, /access_token_encrypted = NULL/i);
  assert.deepEqual(database.queries[1].values, ["user-1", "project_v2"]);
}

{
  const state = stateService.createState(
    {
      userId: "user-1",
      returnUrl: "https://pilo.test/settings/integrations/github"
    },
    baseConfig
  );
  const statePayload = stateService.verifyState(state, baseConfig);
  const database = new FakeDatabase([], {
    queryOne(text) {
      if (/UPDATE github_callback_states/i.test(text)) {
        return {
          user_id: "user-1",
          workspace_id: null,
          return_url: "https://pilo.test/settings/integrations/github",
          expires_at: new Date(statePayload.expiresAt)
        };
      }

      if (/INSERT INTO github_oauth_connections/i.test(text)) {
        return connectedRow;
      }

      return undefined;
    }
  });
  const githubClient = {
    async exchangeCodeForAccessToken(input) {
      assert.equal(input.code, "oauth-code");
      assert.equal(input.redirectUri, "https://api.pilo.test/api/v1/github/oauth/callback");
      return {
        accessToken: "plain-access-token",
        scope: ""
      };
    },
    async getAuthenticatedUser(accessToken) {
      assert.equal(accessToken, "plain-access-token");
      return {
        id: 12345678,
        login: "juhyeong"
      };
    }
  };
  const service = new GithubIntegrationService(
    database,
    githubClient,
    stateService,
    tokenEncryption,
    configService
  );

  const callback = await service.completeGithubOAuthCallback({
    code: "oauth-code",
    state
  }, "pilo_github_oauth_state=oauth-binding-token");

  assert.deepEqual(callback, {
    connected: true,
    githubUserId: 12345678,
    githubLogin: "juhyeong",
    tokenScope: "",
    githubConnectedAt: "2026-07-04T12:00:00.000Z",
    returnUrl: "https://pilo.test/settings/integrations/github"
  });

  const update = database.queries.at(-1);
  assert.match(update.text, /INSERT INTO github_oauth_connections/i);
  assert.equal(update.values[0], "user-1");
  assert.equal(update.values[1], "app_user");
  assert.equal(update.values[2], 12345678);
  assert.equal(update.values[3], "juhyeong");
  assert.notEqual(update.values[4], "plain-access-token");
  assert.match(update.values[4], /^v1:/);
}

{
  const state = stateService.createState(
    {
      userId: "user-1",
      returnUrl: "https://pilo.test/settings/integrations/github"
    },
    baseConfig
  );
  const statePayload = stateService.verifyState(state, baseConfig);
  const database = new FakeDatabase([], {
    queryOne(text) {
      if (/UPDATE github_callback_states/i.test(text)) {
        return {
          user_id: "user-1",
          workspace_id: null,
          return_url: "https://pilo.test/settings/integrations/github",
          expires_at: new Date(statePayload.expiresAt)
        };
      }

      return undefined;
    }
  });
  const service = new GithubIntegrationService(
    database,
    {
      async exchangeCodeForAccessToken() {
        throw new Error("provider network details must not leak");
      }
    },
    stateService,
    tokenEncryption,
    configService
  );

  await assert.rejects(
    () =>
      service.completeGithubOAuthCallback(
        {
          code: "oauth-code",
          state
        },
        "pilo_github_oauth_state=oauth-binding-token"
      ),
    (error) =>
      error?.returnUrl === "https://pilo.test/settings/integrations/github" &&
      error?.callbackError === "token_exchange_failed" &&
      error?.response?.error?.message === "GitHub OAuth token exchange failed"
  );
}

{
  const state = stateService.createState(
    {
      userId: "user-1",
      returnUrl: "https://pilo.test/settings/integrations/github"
    },
    baseConfig
  );
  const statePayload = stateService.verifyState(state, baseConfig);
  const database = new FakeDatabase([], {
    queryOne(text) {
      if (/UPDATE github_callback_states/i.test(text)) {
        return {
          user_id: "user-1",
          workspace_id: null,
          return_url: "https://pilo.test/settings/integrations/github",
          expires_at: new Date(statePayload.expiresAt)
        };
      }

      return undefined;
    }
  });
  let tokenExchangeCalled = false;
  const service = new GithubIntegrationService(
    database,
    {
      async exchangeCodeForAccessToken() {
        tokenExchangeCalled = true;
        throw new Error("token exchange should not run after provider cancel");
      }
    },
    stateService,
    tokenEncryption,
    configService
  );

  await assert.rejects(
    () =>
      service.completeGithubOAuthCallback(
        {
          error: "access_denied",
          state
        },
        "pilo_github_oauth_state=oauth-binding-token"
      ),
    (error) =>
      error?.returnUrl === "https://pilo.test/settings/integrations/github" &&
      error?.callbackError === "authorization_cancelled" &&
      error?.response?.error?.message === "GitHub authorization was cancelled"
  );
  assert.equal(tokenExchangeCalled, false);
}

{
  const state = stateService.createState(
    {
      userId: "user-1",
      returnUrl: null
    },
    baseConfig
  );
  const statePayload = stateService.verifyState(state, baseConfig);
  const uniqueViolation = new Error("duplicate GitHub account");
  uniqueViolation.code = "23505";
  uniqueViolation.constraint = "users_github_user_id_key";
  const database = new FakeDatabase([], {
    queryOne(text) {
      if (/UPDATE github_callback_states/i.test(text)) {
        return {
          user_id: "user-1",
          workspace_id: null,
          return_url: null,
          expires_at: new Date(statePayload.expiresAt)
        };
      }

      if (/INSERT INTO github_oauth_connections/i.test(text)) {
        throw uniqueViolation;
      }

      return undefined;
    }
  });
  const service = new GithubIntegrationService(
    database,
    {
      async exchangeCodeForAccessToken() {
        return {
          accessToken: "plain-access-token",
          scope: ""
        };
      },
      async getAuthenticatedUser() {
        return {
          id: 12345678,
          login: "juhyeong"
        };
      }
    },
    stateService,
    tokenEncryption,
    configService
  );

  await assert.rejects(
    () =>
      service.completeGithubOAuthCallback(
        {
          code: "oauth-code",
          state
        },
        "pilo_github_oauth_state=oauth-binding-token"
      ),
    (error) =>
      error?.getStatus?.() === 409 &&
      error?.response?.error?.code === "CONFLICT" &&
      error?.response?.error?.message ===
        "GitHub account is already connected to another PILO account"
  );
}

{
  const state = stateService.createState(
    {
      userId: "user-1",
      returnUrl: null
    },
    baseConfig
  );
  let stateConsumeCount = 0;
  const database = new FakeDatabase([], {
    queryOne(text) {
      if (/UPDATE github_callback_states/i.test(text)) {
        stateConsumeCount += 1;
        if (stateConsumeCount > 1) {
          return null;
        }

        return {
          user_id: "user-1",
          workspace_id: null,
          return_url: null,
          expires_at: fixedNow
        };
      }

      if (/INSERT INTO github_oauth_connections/i.test(text)) {
        return {
          ...connectedRow,
          connected_at: fixedNow
        };
      }

      return undefined;
    }
  });
  const githubClient = {
    async exchangeCodeForAccessToken(input) {
      assert.match(input.code, /^oauth-code-/);
      return {
        accessToken: "plain-access-token",
        scope: ""
      };
    },
    async getAuthenticatedUser() {
      return {
        id: 12345678,
        login: "juhyeong"
      };
    }
  };
  const service = new GithubIntegrationService(
    database,
    githubClient,
    stateService,
    tokenEncryption,
    configService
  );

  await service.completeGithubOAuthCallback(
    {
      code: "oauth-code-1",
      state
    },
    "pilo_github_oauth_state=oauth-binding-token"
  );

  await assert.rejects(
    () =>
      service.completeGithubOAuthCallback(
        {
          code: "oauth-code-2",
          state
        },
        "pilo_github_oauth_state=oauth-binding-token"
      ),
    (error) => error?.response?.error?.message === "Invalid OAuth state"
  );
}

{
  const state = stateService.createState(
    {
      userId: "user-1",
      returnUrl: null
    },
    baseConfig
  );
  let tokenExchangeCalled = false;
  const service = new GithubIntegrationService(
    new FakeDatabase(),
    {
      async exchangeCodeForAccessToken() {
        tokenExchangeCalled = true;
        throw new Error("token exchange should not run without a state cookie");
      }
    },
    stateService,
    tokenEncryption,
    configService
  );

  await assert.rejects(
    () =>
      service.completeGithubOAuthCallback(
        {
          code: "oauth-code",
          state
        },
        null
      ),
    (error) => error?.response?.error?.message === "Invalid OAuth state"
  );
  assert.equal(tokenExchangeCalled, false);
}

{
  const database = new FakeDatabase([{ id: "user-1" }]);
  const service = new GithubIntegrationService(
    database,
    {},
    stateService,
    tokenEncryption,
    configService
  );

  const result = await service.disconnectGithubOAuth("user-1");

  assert.deepEqual(result, { disconnected: true });
  assert.match(database.queries[1].text, /UPDATE github_oauth_connections/i);
  assert.match(database.queries[1].text, /access_token_encrypted = NULL/i);
  assert.deepEqual(database.queries[1].values, ["user-1", "app_user"]);
  assert.match(database.queries[2].text, /UPDATE users SET github_access_token_encrypted = NULL/i);
}
