import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { GithubOAuthConnectionService } = require(
  "../../dist/modules/github-integration/github-oauth-connection.service.js"
);

const migration = await readFile(
  new URL("../../../../db/migrations/043_create_github_oauth_connections.sql", import.meta.url),
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

assert.match(migration, /CREATE TABLE github_oauth_connections/i);
assert.match(migration, /purpose IN \('app_user', 'project_v2'\)/i);
assert.match(migration, /uq_github_oauth_connections_active_user_purpose/i);
assert.match(migration, /uq_github_oauth_connections_active_github_account_purpose/i);
assert.match(migration, /ENABLE ROW LEVEL SECURITY/i);
assert.match(service, /disconnectMismatchedConnections/);
assert.match(service, /github_user_id IS DISTINCT FROM \$2/);
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
        tokenScope: null
      }),
    (error) =>
      error?.response?.error?.message ===
      "GitHub account is already connected to another PILO account"
  );
  assert.equal(database.calls.length, 1);
  assert.match(database.calls[0].text, /SELECT id FROM users WHERE id <> \$1 AND github_user_id = \$2/i);
}
