import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { GithubOAuthConnectionService } = require(
  "../../dist/modules/github-integration/github-oauth-connection.service.js"
);
const { GithubOAuthRefreshRejectedError } = require(
  "../../dist/modules/github-integration/github-oauth-refresh.error.js"
);

const migrationsDirectory = new URL("../../../../db/migrations/", import.meta.url);
const migrationNames = await readdir(migrationsDirectory);
assert.equal(migrationNames.includes("090_add_github_oauth_token_refresh.sql"), true);
const refreshMigration = await readFile(
  new URL("090_add_github_oauth_token_refresh.sql", migrationsDirectory),
  "utf8"
);
const connectionMigration = await readFile(
  new URL("../../../../db/migrations/044_create_github_oauth_connections.sql", import.meta.url),
  "utf8"
);
const service = await readFile(
  new URL("../../src/modules/github-integration/github-oauth-connection.service.ts", import.meta.url),
  "utf8"
);
const reviewService = await readFile(
  new URL("../../src/modules/github-integration/github-review-submission.service.ts", import.meta.url),
  "utf8"
);

assert.match(connectionMigration, /CREATE TABLE github_oauth_connections/i);
assert.match(connectionMigration, /purpose IN \('app_user', 'project_v2'\)/i);
assert.match(connectionMigration, /uq_github_oauth_connections_active_user_purpose/i);
assert.match(connectionMigration, /uq_github_oauth_connections_active_github_account_purpose/i);
assert.match(connectionMigration, /ENABLE ROW LEVEL SECURITY/i);
assert.match(refreshMigration, /refresh_token_encrypted TEXT/i);
assert.match(refreshMigration, /access_token_expires_at TIMESTAMPTZ/i);
assert.match(refreshMigration, /refresh_token_expires_at TIMESTAMPTZ/i);
assert.equal((refreshMigration.match(/ADD COLUMN IF NOT EXISTS/gi) ?? []).length, 3);
assert.match(service, /disconnectMismatchedConnections/);
assert.match(service, /github_user_id <> \$2/);
assert.doesNotMatch(service, /github_(?:project_)?access_token_encrypted/i);
assert.match(reviewService, /getActiveConnection\(currentUserId, "app_user"\)/);
assert.doesNotMatch(reviewService, /FROM users[\s\S]*github_access_token_encrypted/i);

{
  const uniqueViolation = Object.assign(new Error("duplicate account"), {
    code: "23505"
  });
  const database = {
    calls: [],
    async queryOne(text, values) {
      this.calls.push({ text, values });
      throw uniqueViolation;
    },
    async query() {},
    async transaction(callback) {
      return callback(this);
    }
  };
  const service = new GithubOAuthConnectionService(
    database,
    {},
    {}
  );

  await assert.rejects(
    () =>
      service.saveConnection({
        userId: "user-a",
        purpose: "app_user",
        githubUserId: 42,
        githubLogin: "octocat",
        encryptedToken: "encrypted-token",
        encryptedRefreshToken: "encrypted-refresh-token",
        accessTokenExpiresAt: "2026-07-17T08:00:00.000Z",
        refreshTokenExpiresAt: "2027-01-17T00:00:00.000Z",
        tokenScope: null
      }),
    (error) =>
      error?.response?.error?.message ===
      "GitHub account is already connected to another PILO account"
  );
  assert.equal(database.calls.length, 1);
  assert.match(database.calls[0].text, /INSERT INTO github_oauth_connections/i);
}

{
  const database = {
    async queryOne() {
      return null;
    }
  };
  const connectionService = new GithubOAuthConnectionService(database, {}, {});

  await assert.rejects(
    () => connectionService.getStatus("missing-user", "app_user"),
    (error) => error?.response?.error?.message === "Current user not found"
  );
}

const fixedNowEpochMs = Date.parse("2026-07-17T00:00:00.000Z");
const runtimeConfig = {
  clientId: "client-id",
  clientSecret: "client-secret"
};
const configService = {
  getGithubOAuthConfig() {
    return runtimeConfig;
  },
  getGithubProjectOAuthConfig() {
    return runtimeConfig;
  }
};
const tokenEncryption = {
  encryptToken(value) {
    return `encrypted:${value}`;
  },
  decryptToken(value) {
    assert.match(value, /^encrypted:/);
    return value.slice("encrypted:".length);
  }
};

function connectionRow(overrides = {}) {
  return {
    id: "connection-1",
    github_user_id: "42",
    github_login: "octocat",
    access_token_encrypted: "encrypted:access-token",
    refresh_token_encrypted: "encrypted:refresh-token",
    token_scope: "repo",
    access_token_expires_at: new Date(fixedNowEpochMs + 240_000).toISOString(),
    refresh_token_expires_at: new Date(fixedNowEpochMs + 86_400_000).toISOString(),
    connected_at: "2026-07-16T00:00:00.000Z",
    revoked_at: null,
    ...overrides
  };
}

class RecordingDatabase {
  constructor(unlockedRow, lockedRow = unlockedRow) {
    this.unlockedRow = unlockedRow;
    this.lockedRow = lockedRow;
    this.queries = [];
    this.transactions = 0;
  }

  async queryOne(text, values = []) {
    this.queries.push({ method: "queryOne", text, values, transaction: false });
    return this.unlockedRow;
  }

  async query(text, values = []) {
    this.queries.push({ method: "query", text, values, transaction: false });
    return [];
  }

  async transaction(callback) {
    this.transactions += 1;
    const transaction = {
      queryOne: async (text, values = []) => {
        this.queries.push({ method: "queryOne", text, values, transaction: true });
        return this.lockedRow;
      },
      query: async (text, values = []) => {
        this.queries.push({ method: "query", text, values, transaction: true });
        return [];
      }
    };
    return callback(transaction);
  }
}

async function withFixedNow(callback) {
  const originalNow = Date.now;
  Date.now = () => fixedNowEpochMs;
  try {
    return await callback();
  } finally {
    Date.now = originalNow;
  }
}

function createConnectionService(database, oauthClient = {}) {
  return new GithubOAuthConnectionService(
    database,
    tokenEncryption,
    configService,
    oauthClient
  );
}

function findTransactionQuery(database, pattern) {
  return database.queries.find(
    (query) => query.transaction && pattern.test(query.text)
  );
}

function assertClearsRefreshMetadata(query) {
  assert.ok(query, "expected a transaction cleanup query");
  assert.match(query.text, /access_token_encrypted\s*=\s*NULL/i);
  assert.match(query.text, /refresh_token_encrypted\s*=\s*NULL/i);
  assert.match(query.text, /token_scope\s*=\s*NULL/i);
  assert.match(query.text, /access_token_expires_at\s*=\s*NULL/i);
  assert.match(query.text, /refresh_token_expires_at\s*=\s*NULL/i);
  assert.match(query.text, /revoked_at\s*=\s*now\(\)/i);
}

{
  const database = new RecordingDatabase(
    connectionRow({
      access_token_expires_at: new Date(fixedNowEpochMs + 301_000).toISOString()
    })
  );
  let refreshCalls = 0;
  const service = createConnectionService(database, {
    async refreshAccessToken() {
      refreshCalls += 1;
      throw new Error("refresh must not run before the five-minute threshold");
    }
  });

  const connection = await withFixedNow(() =>
    service.getActiveConnection("user-a", "app_user")
  );

  assert.equal(connection.accessToken, "access-token");
  assert.equal(refreshCalls, 0);
  assert.equal(database.transactions, 0);
}

{
  const database = new RecordingDatabase(
    connectionRow({
      access_token_expires_at: null,
      refresh_token_encrypted: null,
      refresh_token_expires_at: null
    })
  );
  let refreshCalls = 0;
  const service = createConnectionService(database, {
    async refreshAccessToken() {
      refreshCalls += 1;
    }
  });

  const connection = await withFixedNow(() =>
    service.getActiveConnection("user-a", "app_user")
  );

  assert.equal(connection.accessToken, "access-token");
  assert.equal(refreshCalls, 0);
  assert.equal(database.transactions, 0);
}

{
  const unlockedRow = connectionRow();
  const database = new RecordingDatabase(unlockedRow);
  const refreshCalls = [];
  const service = createConnectionService(database, {
    async refreshAccessToken(input) {
      refreshCalls.push(input);
      return {
        accessToken: "rotated-access-token",
        refreshToken: "rotated-refresh-token",
        scope: "repo read:user",
        accessTokenExpiresAt: "2026-07-17T08:00:00.000Z",
        refreshTokenExpiresAt: "2027-01-17T00:00:00.000Z"
      };
    }
  });

  const connection = await withFixedNow(() =>
    service.getActiveConnection("user-a", "app_user")
  );

  assert.equal(connection.accessToken, "rotated-access-token");
  assert.deepEqual(refreshCalls, [{
    clientId: "client-id",
    clientSecret: "client-secret",
    refreshToken: "refresh-token"
  }]);
  assert.equal(database.transactions, 1);
  const lock = findTransactionQuery(database, /SELECT[\s\S]*FOR UPDATE/i);
  assert.ok(lock);
  const rotation = findTransactionQuery(database, /UPDATE github_oauth_connections/i);
  assert.ok(rotation);
  assert.match(rotation.text, /WHERE id\s*=\s*\$1/i);
  assert.equal(rotation.values.includes("rotated-access-token"), false);
  assert.equal(rotation.values.includes("rotated-refresh-token"), false);
  assert.equal(rotation.values.includes("encrypted:rotated-access-token"), true);
  assert.equal(rotation.values.includes("encrypted:rotated-refresh-token"), true);
  assert.equal(rotation.values.includes("2026-07-17T08:00:00.000Z"), true);
  assert.equal(rotation.values.includes("2027-01-17T00:00:00.000Z"), true);
}

{
  const database = new RecordingDatabase(
    connectionRow(),
    connectionRow({
      access_token_encrypted: "encrypted:already-rotated-access-token",
      access_token_expires_at: new Date(fixedNowEpochMs + 360_000).toISOString()
    })
  );
  let refreshCalls = 0;
  const service = createConnectionService(database, {
    async refreshAccessToken() {
      refreshCalls += 1;
    }
  });

  const connection = await withFixedNow(() =>
    service.getActiveConnection("user-a", "app_user")
  );

  assert.equal(connection.accessToken, "already-rotated-access-token");
  assert.equal(refreshCalls, 0);
  assert.equal(database.transactions, 1);
  assert.ok(findTransactionQuery(database, /FOR UPDATE/i));
  assert.equal(findTransactionQuery(database, /UPDATE github_oauth_connections/i), undefined);
}

for (const lockedRow of [
  connectionRow({ refresh_token_encrypted: null }),
  connectionRow({
    refresh_token_expires_at: new Date(fixedNowEpochMs).toISOString()
  })
]) {
  const database = new RecordingDatabase(connectionRow(), lockedRow);
  const service = createConnectionService(database, {
    async refreshAccessToken() {
      throw new Error("refresh must not run without a usable refresh token");
    }
  });

  await assert.rejects(
    () => withFixedNow(() => service.getActiveConnection("user-a", "app_user")),
    (error) => error?.response?.error?.message === "GitHub OAuth reconnection is required"
  );
  assertClearsRefreshMetadata(
    findTransactionQuery(database, /UPDATE github_oauth_connections/i)
  );
}

{
  const database = new RecordingDatabase(connectionRow());
  const service = createConnectionService(database, {
    async refreshAccessToken() {
      throw new GithubOAuthRefreshRejectedError();
    }
  });

  await assert.rejects(
    () => withFixedNow(() => service.getActiveConnection("user-a", "app_user")),
    (error) => error?.response?.error?.message === "GitHub OAuth reconnection is required"
  );
  assertClearsRefreshMetadata(
    findTransactionQuery(database, /UPDATE github_oauth_connections/i)
  );
}

{
  const transientError = new Error("temporary provider failure");
  const database = new RecordingDatabase(connectionRow());
  const service = createConnectionService(database, {
    async refreshAccessToken() {
      throw transientError;
    }
  });

  await assert.rejects(
    () => withFixedNow(() => service.getActiveConnection("user-a", "app_user")),
    (error) => error === transientError
  );
  assert.equal(
    findTransactionQuery(database, /UPDATE github_oauth_connections/i),
    undefined
  );
}

{
  const database = new RecordingDatabase(connectionRow());
  const service = createConnectionService(database);

  await service.disconnectConnection("user-a", "app_user");
  assertClearsRefreshMetadata(
    database.queries.find((query) => /UPDATE github_oauth_connections/i.test(query.text))
  );

  database.queries.length = 0;
  await service.disconnectMismatchedConnectionsInTransaction(
    database,
    "user-a",
    99
  );
  assertClearsRefreshMetadata(
    database.queries.find((query) => /UPDATE github_oauth_connections/i.test(query.text))
  );
}
