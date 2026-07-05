import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const appModule = await readFile(new URL("../../src/app.module.ts", import.meta.url), "utf8");
const moduleFile = await readFile(
  new URL("../../src/modules/github-integration/github-integration.module.ts", import.meta.url),
  "utf8"
);
const controllerFile = await readFile(
  new URL("../../src/modules/github-integration/github-integration.controller.ts", import.meta.url),
  "utf8"
);
const serviceFile = await readFile(
  new URL("../../src/modules/github-integration/github-integration.service.ts", import.meta.url),
  "utf8"
);
const typesIndex = await readFile(
  new URL("../../src/modules/github-integration/types/index.ts", import.meta.url),
  "utf8"
);

const githubIntegrationDirectory = new URL(
  "../../src/modules/github-integration/",
  import.meta.url
);
const entries = await readdir(githubIntegrationDirectory, { withFileTypes: true });
const directoryNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

assert.match(appModule, /import \{ GithubIntegrationModule \}/);
assert.match(appModule, /imports: \[[^\]]*GithubIntegrationModule[^\]]*\]/);

assert.match(moduleFile, /imports: \[[\s\S]*DatabaseModule[\s\S]*WorkspaceModule[\s\S]*\]/);
assert.match(moduleFile, /controllers: \[GithubIntegrationController\]/);
assert.match(moduleFile, /providers: \[[\s\S]*GithubIntegrationService[\s\S]*\]/);
assert.match(moduleFile, /providers: \[[\s\S]*GithubAppClient[\s\S]*\]/);
assert.match(moduleFile, /providers: \[[\s\S]*GithubAppInstallationStateService[\s\S]*\]/);
assert.match(moduleFile, /exports: \[GithubIntegrationService\]/);

assert.match(controllerFile, /@Controller\(\)/);
assert.match(controllerFile, /constructor\(private readonly githubIntegrationService/);
assert.match(controllerFile, /@Get\("me\/github"\)/);
assert.match(controllerFile, /@Post\("me\/github\/oauth\/start"\)/);
assert.match(controllerFile, /@Get\("github\/oauth\/callback"\)/);
assert.match(controllerFile, /@Delete\("me\/github"\)/);
assert.match(controllerFile, /@Post\("workspaces\/:workspaceId\/github\/installations\/start"\)/);
assert.match(controllerFile, /@Get\("github\/installations\/callback"\)/);
assert.match(controllerFile, /@Get\("workspaces\/:workspaceId\/github\/installations"\)/);
assert.match(controllerFile, /@UseGuards\(AuthGuard\)/);

assert.match(serviceFile, /getModuleInfo\(\): GitHubIntegrationModuleInfo/);
assert.match(serviceFile, /domain: "github-integration"/);
assert.match(serviceFile, /apiContract: "docs\/api\/github-integration-api\.md"/);
assert.match(serviceFile, /getGithubOAuthStatus/);
assert.match(serviceFile, /startGithubOAuth/);
assert.match(serviceFile, /completeGithubOAuthCallback/);
assert.match(serviceFile, /disconnectGithubOAuth/);
assert.match(serviceFile, /startGithubAppInstallation/);
assert.match(serviceFile, /completeGithubAppInstallationCallback/);
assert.match(serviceFile, /listGithubAppInstallations/);

assert.match(typesIndex, /export type GitHubIntegrationModuleInfo/);
assert.deepEqual(directoryNames.sort(), ["dto", "queries", "types"]);

const tscScript = fileURLToPath(
  new URL("../../node_modules/typescript/bin/tsc", import.meta.url)
);
execFileSync(process.execPath, [tscScript, "-p", "tsconfig.build.json"], {
  cwd: new URL("../..", import.meta.url),
  stdio: "inherit"
});

await import("./oauth.test.mjs");
await import("./installation.test.mjs");
