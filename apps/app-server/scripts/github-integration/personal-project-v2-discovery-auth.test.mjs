import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  GithubProjectV2SyncTokenService
} = require("../../dist/modules/github-integration/github-project-v2-sync-token.service.js");
const {
  GithubProjectV2Service
} = require("../../dist/modules/github-integration/github-project-v2.service.js");

const userAccessToken = "user-project-v2-access-token";
const ownerLogin = "juhyung";
const connectionService = {
  async getActiveConnection() {
    return {
      githubLogin: ownerLogin,
      tokenScope: "repo project",
      accessToken: userAccessToken
    };
  }
};
const tokenService = new GithubProjectV2SyncTokenService(
  {},
  {},
  {},
  connectionService
);

assert.equal(
  await tokenService.resolvePersonalProjectV2UserAccessToken({
    currentUserId: "current-user-id",
    installation: { account_login: "pilo-organization", account_type: "Organization" },
    repositoryOwnerLogin: ownerLogin,
    repositoryOwnerType: "User",
    requiresProjectV2Access: true
  }),
  userAccessToken,
  "a personal repository owner must use the matching ProjectV2 OAuth token even when its installation is stored as an organization"
);

{
  const projectOnlyTokenService = new GithubProjectV2SyncTokenService(
    {},
    {},
    {},
    {
      async getActiveConnection() {
        return {
          githubLogin: ownerLogin,
          tokenScope: "project",
          accessToken: userAccessToken
        };
      }
    }
  );

  await assert.rejects(
    () =>
      projectOnlyTokenService.resolvePersonalProjectV2UserAccessToken({
        currentUserId: "current-user-id",
        installation: {
          account_login: "pilo-organization",
          account_type: "Organization"
        },
        repositoryOwnerLogin: ownerLogin,
        repositoryOwnerType: "User",
        requiresProjectV2Access: true
      }),
    (error) =>
      error.getResponse().error.message ===
      "GitHub ProjectV2 OAuth connection must be reconnected with project and repo scopes",
    "a project-only token must be reconnected before personal ProjectV2 sync"
  );
}

const organizationToken = await tokenService.resolvePersonalProjectV2UserAccessToken({
  currentUserId: "current-user-id",
  installation: { account_login: "pilo-organization", account_type: "Organization" },
  repositoryOwnerLogin: "pilo-organization",
  repositoryOwnerType: "Organization",
  requiresProjectV2Access: true
});
assert.equal(
  organizationToken,
  null,
  "an actual organization repository owner must retain installation-token fallback"
);

for (const connectionService of [
  {
    async getActiveConnection() {
      throw new Error("connection missing");
    }
  },
  {
    async getActiveConnection() {
      return {
        githubLogin: "another-user",
        tokenScope: "repo project",
        accessToken: userAccessToken
      };
    }
  }
]) {
  const personalTokenService = new GithubProjectV2SyncTokenService(
    {},
    {},
    {},
    connectionService
  );
  await assert.rejects(
    () => personalTokenService.resolvePersonalProjectV2UserAccessToken({
      currentUserId: "current-user-id",
      installation: { account_login: "pilo-organization", account_type: "Organization" },
      repositoryOwnerLogin: ownerLogin,
      repositoryOwnerType: "User",
      requiresProjectV2Access: true
    }),
    (error) => /GitHub ProjectV2 OAuth (connection is required|account does not match this personal ProjectV2 owner)/.test(
      error.getResponse().error.message
    ),
    "a User repository owner must preserve personal ProjectV2 OAuth errors even when installation metadata is Organization"
  );
}

const legacyRepositoryId = "44444444-4444-4444-8444-444444444444";
const legacyDiscoveryRows = [
  {
    id: "33333333-3333-4333-8333-333333333333",
    workspace_id: "11111111-1111-4111-8111-111111111111",
    github_installation_id: 12345,
    account_login: ownerLogin,
    account_type: "User"
  },
  {
    id: legacyRepositoryId,
    workspace_id: "11111111-1111-4111-8111-111111111111",
    installation_id: "33333333-3333-4333-8333-333333333333",
    github_node_id: "R_legacy",
    owner_login: ownerLogin,
    name: "legacy-repository",
    full_name: `${ownerLogin}/legacy-repository`,
    raw: null
  }
];
const legacyDiscoveryService = new GithubProjectV2Service(
  {
    async queryOne() {
      return legacyDiscoveryRows.shift() ?? null;
    }
  },
  { assertWorkspaceAccess: async () => {} },
  {},
  {},
  {},
  undefined,
  {
    async resolvePersonalProjectV2UserAccessToken() {
      throw new Error("ProjectV2 OAuth connection is missing");
    }
  },
  { getGithubAppConfig: () => ({}) }
);

assert.deepEqual(
  await legacyDiscoveryService.discoverGithubProjectV2(
    "current-user-id",
    "11111111-1111-4111-8111-111111111111",
    "33333333-3333-4333-8333-333333333333",
    { repositoryId: legacyRepositoryId }
  ),
  {
    connectionRequired: true,
    installationId: "33333333-3333-4333-8333-333333333333",
    repositoryId: legacyRepositoryId,
    projects: []
  },
  "a legacy repository with no raw owner type must use the same connection-required decision as the token resolver"
);

const root = new URL("../../../..", import.meta.url);
const projectV2Service = readFileSync(
  new URL("apps/app-server/src/modules/github-integration/github-project-v2.service.ts", root),
  "utf8"
);
const syncRunService = readFileSync(
  new URL("apps/app-server/src/modules/github-integration/github-sync-run.service.ts", root),
  "utf8"
);
const syncJobService = readFileSync(
  new URL("apps/app-server/src/modules/github-integration/github-sync-job.service.ts", root),
  "utf8"
);
const executor = readFileSync(
  new URL("apps/app-server/src/modules/github-integration/github-sync-executor.service.ts", root),
  "utf8"
);
const apiDocument = readFileSync(
  new URL("docs/api/github-integration-api.md", root),
  "utf8"
);

assert.match(
  projectV2Service,
  /resolvePersonalProjectV2UserAccessToken\(\{[\s\S]*?repositoryOwnerLogin:\s*repository\.owner_login/,
  "discovery must resolve the ProjectV2 token against the selected repository owner"
);
assert.match(
  projectV2Service,
  /SELECT id, workspace_id, installation_id, github_node_id, owner_login, name, full_name, raw[\s\S]*?repositoryOwnerType[\s\S]*?connectionRequired: true/,
  "discovery must derive User-owner authorization from the repository raw payload"
);
assert.match(
  syncRunService,
  /resolvePersonalProjectV2UserAccessToken\(\{[\s\S]*?repositoryOwnerLogin:\s*repository\?\.owner_login\s*\?\?\s*null/,
  "direct repository-scoped full sync must resolve against its repository owner"
);
assert.match(
  syncRunService,
  /SELECT[\s\S]*?owner_login,[\s\S]*?raw[\s\S]*?FROM github_repositories/,
  "direct repository-scoped full sync must load repository raw owner metadata"
);
assert.match(syncRunService, /repositoryOwnerType:/);
assert.match(
  syncJobService,
  /resolvePersonalProjectV2UserAccessToken\(\{[\s\S]*?repositoryOwnerLogin:\s*repository\?\.owner_login\s*\?\?\s*null/,
  "queued repository-scoped full sync must resolve against its repository owner"
);
assert.match(
  syncJobService,
  /owner_login, name, full_name, raw FROM github_repositories/,
  "queued repository-scoped full sync must load repository raw owner metadata"
);
assert.match(syncJobService, /repositoryOwnerType:/);
assert.match(
  executor,
  /private getProjectV2UserAccessToken\([\s\S]*?return context\.githubUserAccessToken \?\? undefined/,
  "the executor must forward any resolved personal ProjectV2 token regardless of installation account type"
);
assert.match(
  apiDocument,
  /repository\(owner, name\)\.projectsV2[\s\S]*?same owner as that repository/i,
  "the ProjectV2 API contract must keep repository discovery scoped to its owner"
);
assert.match(
  apiDocument,
  /User repository owner[\s\S]{0,80}active ProjectV2 OAuth GitHub login[\s\S]{0,120}installation\s+metadata is `Organization`/i,
  "the API contract must document personal-token selection from the repository owner rather than installation metadata"
);
assert.match(
  apiDocument,
  /actual Organization repository[\s\S]{0,80}installation-token fallback/i,
  "the API contract must retain installation-token fallback for organization-owned repositories"
);

console.log("personal ProjectV2 discovery auth tests passed");
