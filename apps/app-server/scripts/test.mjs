import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const controller = await readFile(
  new URL("../src/app.controller.ts", import.meta.url),
  "utf8"
);
const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const service = await readFile(new URL("../src/app.service.ts", import.meta.url), "utf8");
const appModule = await readFile(new URL("../src/app.module.ts", import.meta.url), "utf8");
const githubIntegrationModule = await readFile(
  new URL("../src/modules/github-integration/github-integration.module.ts", import.meta.url),
  "utf8"
);
const githubIntegrationController = await readFile(
  new URL("../src/modules/github-integration/github-integration.controller.ts", import.meta.url),
  "utf8"
);
const githubIntegrationService = await readFile(
  new URL("../src/modules/github-integration/github-integration.service.ts", import.meta.url),
  "utf8"
);
const githubIntegrationDtoIndex = await readFile(
  new URL("../src/modules/github-integration/dto/index.ts", import.meta.url),
  "utf8"
);
const githubIntegrationQueriesIndex = await readFile(
  new URL("../src/modules/github-integration/queries/index.ts", import.meta.url),
  "utf8"
);
const githubIntegrationTypesIndex = await readFile(
  new URL("../src/modules/github-integration/types/index.ts", import.meta.url),
  "utf8"
);

assert.match(main, /setGlobalPrefix\("api\/v1"\)/);
assert.match(controller, /@Get\("health"\)/);
assert.match(service, /pilo-app-server/);
assert.match(service, /status: "ok"/);
assert.match(appModule, /GithubIntegrationModule/);
assert.match(githubIntegrationModule, /controllers: \[GithubIntegrationController\]/);
assert.match(githubIntegrationModule, /providers: \[GithubIntegrationService\]/);
assert.match(githubIntegrationController, /@Controller\(\)/);
assert.match(githubIntegrationService, /docs\/api\/github-integration-api\.md/);
assert.match(githubIntegrationDtoIndex, /export \{\};/);
assert.match(githubIntegrationQueriesIndex, /export \{\};/);
assert.match(githubIntegrationTypesIndex, /GitHubIntegrationModuleInfo/);
