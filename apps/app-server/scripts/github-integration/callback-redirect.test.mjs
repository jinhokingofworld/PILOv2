import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const { badRequest } = require("../../dist/common/api-error.js");
const { GithubIntegrationController } = require("../../dist/modules/github-integration/github-integration.controller.js");
const {
  GithubOAuthAccountAlreadyConnectedError
} = require("../../dist/modules/github-integration/github-oauth-callback-error.js");
const {
  validateGithubCallbackReturnUrl
} = require("../../dist/modules/github-integration/github-return-url.js");

const frontendUrl = "https://pilo.test";

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
  const allowedReturnUrls = new Map([
    [
      "/settings/integrations?tab=github#connected",
      "https://pilo.test/settings/integrations?tab=github#connected"
    ],
    [
      "https://pilo.test/settings/integrations/github",
      "https://pilo.test/settings/integrations/github"
    ],
    [
      "https://pilo.test/github?return_to=%2Fboard",
      "https://pilo.test/github?return_to=%2Fboard"
    ]
  ]);

  for (const [returnUrl, expected] of allowedReturnUrls) {
    assert.equal(validateGithubCallbackReturnUrl(returnUrl, frontendUrl), expected);
  }
}

{
  const rejectedReturnUrls = [
    "/\\evil.example",
    "/\\\\evil.example",
    "//evil.example",
    "/%5cevil.example",
    "/%5C%5Cevil.example",
    "/%2f%2fevil.example",
    "https://pilo.test/%5cevil.example"
  ];

  for (const returnUrl of rejectedReturnUrls) {
    assert.throws(
      () => validateGithubCallbackReturnUrl(returnUrl, frontendUrl),
      (error) => error?.response?.error?.message === "Invalid returnUrl",
      `Expected ${JSON.stringify(returnUrl)} to be rejected`
    );
  }
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
    async completeGithubOAuthCallback() {
      throw new GithubOAuthAccountAlreadyConnectedError(
        "https://pilo.test/settings/integrations/github?tab=connect"
      );
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
      url: "https://pilo.test/settings/integrations/github?tab=connect&github_callback_error=account_already_connected&github_oauth_error=account_already_connected",
      statusCode: 302
    }
  ]);
}

{
  const controller = new GithubIntegrationController({
    async completeGithubOAuthCallback() {
      throw badRequest("Invalid OAuth state");
    },
    getGithubCallbackFailureRedirectUrl() {
      return "https://pilo.test/github";
    }
  });
  const reply = createReply();

  const result = await controller.completeGithubOAuthCallback(
    { code: "oauth-code", state: "oauth-state" },
    undefined,
    reply
  );

  assert.equal(result, undefined);
  assert.deepEqual(reply.redirects, [
    {
      url: "https://pilo.test/github?github_callback_error=invalid_state",
      statusCode: 302
    }
  ]);
}

{
  const controller = new GithubIntegrationController({
    async completeGithubProjectOAuthCallback() {
      throw badRequest(
        "GitHub ProjectV2 OAuth connection must be reconnected with project scope"
      );
    },
    getGithubCallbackFailureRedirectUrl() {
      return "https://pilo.test/github";
    }
  });
  const reply = createReply();

  const result = await controller.completeGithubProjectOAuthCallback(
    { code: "project-oauth-code", state: "project-oauth-state" },
    "pilo_github_project_oauth_state=binding-token",
    reply
  );

  assert.equal(result, undefined);
  assert.deepEqual(reply.redirects, [
    {
      url: "https://pilo.test/github?github_callback_error=project_oauth_scope_missing",
      statusCode: 302
    }
  ]);
}

{
  const controller = new GithubIntegrationController({
    async completeGithubAppInstallationCallback() {
      throw new Error("database unavailable");
    },
    getGithubCallbackFailureRedirectUrl() {
      return "https://pilo.test/github";
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
      url: "https://pilo.test/github?github_callback_error=connection_failed",
      statusCode: 302
    }
  ]);
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
