import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const { AuthService } = require("../../dist/modules/auth/auth.service.js");
const { OAuthStateService } = require("../../dist/modules/auth/oauth-state.service.js");

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
const sessionExpiresAt = new Date("2026-08-03T12:00:00.000Z");
const providerConfig = {
  clientId: "github-login-client-id",
  clientSecret: "github-login-client-secret",
  apiPublicOrigin: "https://api.pilo.test",
  apiBasePath: "/api/v1",
  frontendUrl: "https://pilo.test",
  stateSecret: "auth-state-secret",
  stateTtlSeconds: 600,
  sessionTtlSeconds: 60 * 60,
  now: () => fixedNow
};

function createAuthService(database, options = {}) {
  const stateService = new OAuthStateService();
  const configService = {
    getProviderConfig(provider) {
      assert.equal(provider, "github");
      return providerConfig;
    },
    getFrontendUrl() {
      return providerConfig.frontendUrl;
    },
    getCallbackUrl(provider, config) {
      return `${config.apiPublicOrigin}${config.apiBasePath}/auth/${provider}/callback`;
    },
    getGithubTokenEncryptionKey() {
      throw new Error("GitHub login must not request the integration token key");
    }
  };
  const sessionService = {
    hashSessionToken(accessToken) {
      assert.match(accessToken, /^pilo_/);
      return "hashed-session-token";
    }
  };
  const githubClient = {
    async exchangeCodeForAccessToken(input) {
      assert.equal(input.code, "oauth-code");
      assert.equal(input.clientId, providerConfig.clientId);
      assert.equal(input.clientSecret, providerConfig.clientSecret);
      assert.equal(input.redirectUri, "https://api.pilo.test/api/v1/auth/github/callback");
      return {
        accessToken: "login-oauth-access-token",
        scope: "repo,read:user,user:email"
      };
    },
    async getUserProfile(accessToken) {
      assert.equal(accessToken, "login-oauth-access-token");
      return options.githubProfile ?? {
        id: 12345678,
        login: "juhyeong",
        name: "Juhyeong",
        email: "juhyeong@example.com",
        avatarUrl: "https://github.com/avatar.png"
      };
    }
  };

  return {
    service: new AuthService(
      database,
      sessionService,
      configService,
      stateService,
      {},
      githubClient,
      {
        async disconnectMismatchedConnections(userId, githubUserId) {
          if (options.onDisconnectMismatchedConnections) {
            await options.onDisconnectMismatchedConnections(userId, githubUserId);
            return;
          }
          assert.equal(userId, "user-existing");
          assert.equal(githubUserId, 12345678);
        }
      },
      {
        async ensureDefaultWorkspaceForUser(userId) {
          assert.match(userId, /^user-/);
        }
      }
    ),
    stateService
  };
}

{
  const disconnectedConnections = [];
  const database = new FakeDatabase([
    { id: "user-existing" },
    { id: "user-existing" },
    { expires_at: sessionExpiresAt }
  ]);
  const { service, stateService } = createAuthService(database, {
    githubProfile: {
      id: 87654321,
      login: "account-b",
      name: "Account B",
      email: "juhyeong@example.com",
      avatarUrl: "https://github.com/account-b.png"
    },
    onDisconnectMismatchedConnections(userId, githubUserId) {
      disconnectedConnections.push({ userId, githubUserId });
    }
  });

  await service.completeLoginCallback("github", {
    code: "oauth-code",
    state: createGithubState(stateService)
  });

  assert.deepEqual(disconnectedConnections, [
    { userId: "user-existing", githubUserId: 87654321 }
  ]);
  const update = database.queries.find((query) => /UPDATE users/i.test(query.text));
  assert.deepEqual(update.values, [
    "user-existing",
    87654321,
    "account-b",
    "Account B",
    "juhyeong@example.com",
    "https://github.com/account-b.png"
  ]);
}

function createGithubState(stateService) {
  return stateService.createState(
    {
      provider: "github",
      returnUrl: "/github"
    },
    providerConfig
  );
}

function assertNoGithubAppUserTokenColumns(query) {
  assert.doesNotMatch(query.text, /github_access_token_encrypted/i);
  assert.doesNotMatch(query.text, /github_token_scope/i);
  assert.doesNotMatch(query.text, /github_connected_at/i);
  assert.doesNotMatch(query.text, /github_revoked_at/i);
}

{
  const database = new FakeDatabase([
    { id: "user-existing" },
    { id: "user-existing" },
    { expires_at: sessionExpiresAt }
  ]);
  const { service, stateService } = createAuthService(database);

  const redirect = await service.completeLoginCallback("github", {
    code: "oauth-code",
    state: createGithubState(stateService)
  });

  assert.match(redirect, /^https:\/\/pilo\.test\/login\/callback#/);
  const update = database.queries.find((query) => /UPDATE users/i.test(query.text));
  assert.ok(update);
  assertNoGithubAppUserTokenColumns(update);
  assert.deepEqual(update.values, [
    "user-existing",
    12345678,
    "juhyeong",
    "Juhyeong",
    "juhyeong@example.com",
    "https://github.com/avatar.png"
  ]);
}

{
  const database = new FakeDatabase([
    null,
    { id: "user-new" },
    { expires_at: sessionExpiresAt }
  ]);
  const { service, stateService } = createAuthService(database);

  const redirect = await service.completeLoginCallback("github", {
    code: "oauth-code",
    state: createGithubState(stateService)
  });

  assert.match(redirect, /^https:\/\/pilo\.test\/login\/callback#/);
  const insert = database.queries.find((query) => /INSERT INTO users/i.test(query.text));
  assert.ok(insert);
  assertNoGithubAppUserTokenColumns(insert);
  assert.deepEqual(insert.values, [
    "Juhyeong",
    "juhyeong@example.com",
    "https://github.com/avatar.png",
    12345678,
    "juhyeong"
  ]);
}
