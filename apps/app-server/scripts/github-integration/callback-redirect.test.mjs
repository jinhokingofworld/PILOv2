import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const { GithubIntegrationController } = require("../../dist/modules/github-integration/github-integration.controller.js");

function createReply() {
  return {
    headers: [],
    redirects: [],
    header(name, value) {
      this.headers.push({ name, value });
    },
    redirect(url, statusCode) {
      this.redirects.push({ url, statusCode });
    }
  };
}

{
  const controller = new GithubIntegrationController({
    async completeGithubOAuthCallback(query, cookieHeader) {
      assert.deepEqual(query, { code: "oauth-code", state: "oauth-state" });
      assert.equal(cookieHeader, "pilo_github_oauth_state=binding-token");
      return {
        connected: true,
        githubUserId: 12345678,
        githubLogin: "juhyeong",
        tokenScope: "repo,read:user",
        githubConnectedAt: "2026-07-04T12:00:00.000Z",
        returnUrl: "https://pilo.test/settings/integrations/github"
      };
    }
  });
  const reply = createReply();

  const result = await controller.completeGithubOAuthCallback(
    { code: "oauth-code", state: "oauth-state" },
    "pilo_github_oauth_state=binding-token",
    reply
  );

  assert.equal(result, undefined);
  assert.deepEqual(reply.redirects, [
    {
      url: "https://pilo.test/settings/integrations/github",
      statusCode: 302
    }
  ]);
}

{
  const controller = new GithubIntegrationController({
    async completeGithubOAuthCallback(_query, cookieHeader) {
      assert.equal(cookieHeader, undefined);
      return {
        connected: true,
        githubUserId: 12345678,
        githubLogin: "juhyeong",
        tokenScope: "repo,read:user",
        githubConnectedAt: "2026-07-04T12:00:00.000Z",
        returnUrl: null
      };
    }
  });
  const reply = createReply();

  const result = await controller.completeGithubOAuthCallback({}, undefined, reply);

  assert.deepEqual(result, {
    success: true,
    data: {
      connected: true,
      githubUserId: 12345678,
      githubLogin: "juhyeong",
      tokenScope: "repo,read:user",
      githubConnectedAt: "2026-07-04T12:00:00.000Z",
      returnUrl: null
    }
  });
  assert.deepEqual(reply.redirects, []);
}

{
  const controller = new GithubIntegrationController({
    async completeGithubAppInstallationCallback(query, cookieHeader) {
      assert.deepEqual(query, {
        installation_id: "12345678",
        setup_action: "install",
        state: "installation-state"
      });
      assert.equal(
        cookieHeader,
        "pilo_github_app_installation_state=binding-token"
      );
      return {
        workspaceId: "11111111-1111-4111-8111-111111111111",
        installationId: "33333333-3333-4333-8333-333333333333",
        githubInstallationId: 12345678,
        accountLogin: "my-team",
        accountType: "Organization",
        repositorySelection: "selected",
        permissions: {
          metadata: "read"
        },
        installedByUserId: "22222222-2222-4222-8222-222222222222",
        installedAt: "2026-07-04T12:30:00.000Z",
        suspendedAt: null,
        lastSyncedAt: null,
        returnUrl: "https://pilo.test/workspaces/11111111-1111-4111-8111-111111111111/github"
      };
    }
  });
  const reply = createReply();

  const result = await controller.completeGithubAppInstallationCallback(
    {
      installation_id: "12345678",
      setup_action: "install",
      state: "installation-state"
    },
    "pilo_github_app_installation_state=binding-token",
    reply
  );

  assert.equal(result, undefined);
  assert.deepEqual(reply.redirects, [
    {
      url: "https://pilo.test/workspaces/11111111-1111-4111-8111-111111111111/github",
      statusCode: 302
    }
  ]);
}
