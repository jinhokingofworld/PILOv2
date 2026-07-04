import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

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
assert.match(appModule, /imports: \[GithubIntegrationModule\]/);

assert.match(moduleFile, /controllers: \[GithubIntegrationController\]/);
assert.match(moduleFile, /providers: \[GithubIntegrationService\]/);
assert.match(moduleFile, /exports: \[GithubIntegrationService\]/);

assert.match(controllerFile, /@Controller\(\)/);
assert.match(controllerFile, /constructor\(private readonly githubIntegrationService/);

assert.match(serviceFile, /getModuleInfo\(\): GitHubIntegrationModuleInfo/);
assert.match(serviceFile, /domain: "github-integration"/);
assert.match(serviceFile, /apiContract: "docs\/api\/github-integration-api\.md"/);

assert.match(typesIndex, /export type GitHubIntegrationModuleInfo/);
assert.deepEqual(directoryNames.sort(), ["dto", "queries", "types"]);
