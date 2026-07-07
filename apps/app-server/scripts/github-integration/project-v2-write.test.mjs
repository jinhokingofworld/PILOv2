import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const { GithubProjectV2WriteService } = require("../../dist/modules/github-integration/github-project-v2-write.service.js");

class FakeDatabase {
  constructor(rows = []) {
    this.rows = [...rows];
    this.queries = [];
  }

  async queryOne(text, values = []) {
    this.queries.push({ text, values });
    const next = this.rows.shift();
    if (typeof next === "function") {
      return next(text, values);
    }

    return next ?? null;
  }
}

class FakeGithubAppClient {
  constructor() {
    this.statusUpdates = [];
  }

  async updateProjectV2ItemStatus(input) {
    this.statusUpdates.push(input);
  }
}

const projectOAuthRow = {
  github_project_login: "Developer-EJ",
  github_project_access_token_encrypted: "encrypted-project-oauth-token",
  github_project_token_scope: "read:user,user:email,project",
  github_project_connected_at: "2026-07-05T09:00:00.000Z",
  github_project_revoked_at: null
};

function createService(database, githubAppClient = new FakeGithubAppClient()) {
  return {
    githubAppClient,
    service: new GithubProjectV2WriteService(
      database,
      githubAppClient,
      {
        decryptToken(encryptedToken) {
          assert.equal(encryptedToken, "encrypted-project-oauth-token");
          return "decrypted-project-oauth-token";
        }
      },
      {
        getGithubProjectOAuthConfig() {
          return {
            tokenEncryptionKey: "test-token-encryption-key"
          };
        }
      }
    )
  };
}

{
  const database = new FakeDatabase([
    (text, values) => {
      assert.match(text, /github_project_access_token_encrypted/i);
      assert.doesNotMatch(text, /github_access_token_encrypted/i);
      assert.match(text, /FROM users/i);
      assert.deepEqual(values, ["user-1"]);
      return projectOAuthRow;
    }
  ]);
  const { githubAppClient, service } = createService(database);

  await service.updateProjectV2ItemStatus({
    currentUserId: "user-1",
    projectNodeId: "PVT_kwDOExample",
    itemNodeId: "PVTI_lADOExample",
    fieldNodeId: "PVTSSF_lADOExample",
    singleSelectOptionId: "status-backlog"
  });

  assert.deepEqual(githubAppClient.statusUpdates, [
    {
      userAccessToken: "decrypted-project-oauth-token",
      projectNodeId: "PVT_kwDOExample",
      itemNodeId: "PVTI_lADOExample",
      fieldNodeId: "PVTSSF_lADOExample",
      singleSelectOptionId: "status-backlog"
    }
  ]);
}

{
  const database = new FakeDatabase([
    {
      ...projectOAuthRow,
      github_project_token_scope: "read:user,user:email"
    }
  ]);
  const { githubAppClient, service } = createService(database);

  await assert.rejects(
    () =>
      service.updateProjectV2ItemStatus({
        currentUserId: "user-1",
        projectNodeId: "PVT_kwDOExample",
        itemNodeId: "PVTI_lADOExample",
        fieldNodeId: "PVTSSF_lADOExample",
        singleSelectOptionId: null
      }),
    (error) =>
      error?.response?.error?.message ===
      "GitHub ProjectV2 OAuth connection must be reconnected with project scope"
  );
  assert.deepEqual(githubAppClient.statusUpdates, []);
}
