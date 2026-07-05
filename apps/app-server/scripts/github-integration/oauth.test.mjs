import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const { GithubIntegrationService } = require("../../dist/modules/github-integration/github-integration.service.js");
const { GithubOAuthStateService } = require("../../dist/modules/github-integration/github-oauth-state.service.js");
const { GithubTokenEncryptionService } = require("../../dist/modules/github-integration/github-token-encryption.service.js");

class FakeDatabase {
  constructor(rows = []) {
    this.rows = [...rows];
    this.queries = [];
  }

  async queryOne(text, values = []) {
    this.queries.push({ text, values });
    return this.rows.shift() ?? null;
  }
}

const fixedNow = new Date("2026-07-04T12:00:00.000Z");
const baseConfig = {
  clientId: "client-id",
  clientSecret: "client-secret",
  apiPublicOrigin: "https://api.pilo.test",
  apiBasePath: "/api/v1",
  tokenEncryptionKey: "test-token-encryption-key",
  stateSecret: "test-state-secret",
  stateTtlSeconds: 600,
  now: () => fixedNow
};

const stateService = new GithubOAuthStateService();
const tokenEncryption = new GithubTokenEncryptionService();
const configService = {
  getGithubOAuthConfig() {
    return baseConfig;
  }
};

const connectedRow = {
  github_user_id: "12345678",
  github_login: "juhyeong",
  github_token_scope: "repo,read:user",
  github_connected_at: fixedNow,
  github_revoked_at: null
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
    tokenScope: "repo,read:user",
    githubConnectedAt: "2026-07-04T12:00:00.000Z",
    githubRevokedAt: null
  });
  assert.doesNotMatch(database.queries[0].text, /github_access_token_encrypted/i);
}

{
  const service = new GithubIntegrationService(
    new FakeDatabase(),
    {},
    stateService,
    tokenEncryption,
    configService
  );

  const start = service.startGithubOAuth("user-1", {
    returnUrl: "https://pilo.test/settings/integrations/github"
  });
  const authorizeUrl = new URL(start.authorizeUrl);

  assert.equal(authorizeUrl.origin + authorizeUrl.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(authorizeUrl.searchParams.get("client_id"), "client-id");
  assert.equal(authorizeUrl.searchParams.get("redirect_uri"), "https://api.pilo.test/api/v1/github/oauth/callback");
  assert.equal(authorizeUrl.searchParams.get("scope"), null);
  assert.equal(authorizeUrl.searchParams.get("state"), start.state);

  const parsedState = stateService.verifyState(start.state, baseConfig);
  assert.equal(parsedState.userId, "user-1");
  assert.equal(parsedState.returnUrl, "https://pilo.test/settings/integrations/github");

  const startWithoutBody = service.startGithubOAuth("user-1", undefined);
  const stateWithoutBody = stateService.verifyState(startWithoutBody.state, baseConfig);
  assert.equal(stateWithoutBody.returnUrl, null);
}

{
  const database = new FakeDatabase([
    {
      ...connectedRow,
      github_connected_at: fixedNow
    }
  ]);
  const githubClient = {
    async exchangeCodeForAccessToken(input) {
      assert.equal(input.code, "oauth-code");
      assert.equal(input.redirectUri, "https://api.pilo.test/api/v1/github/oauth/callback");
      return {
        accessToken: "plain-access-token",
        scope: "repo,read:user"
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
  const state = stateService.createState(
    {
      userId: "user-1",
      returnUrl: null
    },
    baseConfig
  );

  const callback = await service.completeGithubOAuthCallback({
    code: "oauth-code",
    state
  });

  assert.deepEqual(callback, {
    connected: true,
    githubUserId: 12345678,
    githubLogin: "juhyeong",
    tokenScope: "repo,read:user",
    githubConnectedAt: "2026-07-04T12:00:00.000Z"
  });

  const update = database.queries.at(-1);
  assert.match(update.text, /UPDATE users/i);
  assert.equal(update.values[0], "user-1");
  assert.equal(update.values[1], 12345678);
  assert.equal(update.values[2], "juhyeong");
  assert.notEqual(update.values[3], "plain-access-token");
  assert.match(update.values[3], /^v1:/);
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
  assert.match(database.queries[0].text, /github_access_token_encrypted = NULL/i);
  assert.match(database.queries[0].text, /github_revoked_at = now\(\)/i);
  assert.deepEqual(database.queries[0].values, ["user-1"]);
}
