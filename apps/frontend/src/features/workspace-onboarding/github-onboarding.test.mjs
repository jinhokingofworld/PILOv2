import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("./github-onboarding.ts", import.meta.url), "utf8");
const pageSource = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
const onboarding = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

assert.deepEqual(
  onboarding.readGithubOnboardingCallback(
    new URLSearchParams(
      "workspaceId=workspace-1&github_onboarding_step=installation&github_installation_id=installation-7&github_callback_error=authorization_cancelled"
    )
  ),
  {
    workspaceId: "workspace-1",
    step: "installation",
    installationId: "installation-7",
    repositoryId: null,
    callbackError: "authorization_cancelled"
  }
);
assert.equal(
  onboarding.createGithubOnboardingReturnUrl("workspace-1", "project-oauth"),
  "/workspace/new?workspaceId=workspace-1&github_onboarding_step=project-oauth"
);
assert.equal(
  onboarding.createGithubOnboardingReturnUrl("workspace-1", "projects", "installation-7", "repository-9"),
  "/workspace/new?workspaceId=workspace-1&github_onboarding_step=projects&github_installation_id=installation-7&repositoryId=repository-9"
);
assert.equal(
  onboarding.createGithubOnboardingReturnUrl("workspace 1", "repositories", "installation 7"),
  "/workspace/new?workspaceId=workspace+1&github_onboarding_step=repositories&github_installation_id=installation+7"
);
assert.equal(
  onboarding.readGithubOnboardingCallback(
    new URLSearchParams("workspaceId=&access_token=secret&state=state")
  ).workspaceId,
  null
);
assert.equal(onboarding.getGithubOnboardingStep("not-a-step"), "oauth");
assert.match(
  onboarding.getGithubCallbackErrorMessage("project_oauth_account_mismatch"),
  /ProjectV2/
);

assert.match(pageSource, /startGithubAppInstallation\(existingWorkspaceId/);
assert.match(pageSource, /getGithubSourceSyncPollingState/);
assert.match(pageSource, /syncState\.status === "success"[\s\S]*setStage\("repositories"\)/);
assert.match(pageSource, /syncState\.status === "failed"[\s\S]*setMessage/);
assert.match(pageSource, /syncState\.status === "missing"[\s\S]*setMessage/);
assert.match(pageSource, /if \(discovery\.connectionRequired\)[\s\S]*startGithubProjectOAuth/);
assert.doesNotMatch(pageSource, /setStage\("project-oauth"\)/);
assert.doesNotMatch(pageSource, /if \(stage === "project-oauth"\)/);
assert.doesNotMatch(pageSource, /async function startProjectOAuth/);
assert.match(pageSource, /callback\.step !== "project-oauth"/);
assert.match(pageSource, /callback\.step === "project-oauth" \? "repositories"/);
assert.match(pageSource, /router\.replace\("\/home"\)/);
assert.match(pageSource, /router\.replace\(createGithubOnboardingReturnUrl\(workspace\.id, "oauth"\)\)/);
assert.match(pageSource, /if \(workspaceId\) \{ await resumeGithub\(workspaceId\); return; \}/);
assert.match(pageSource, /projectIds\.length === 0/);
assert.doesNotMatch(pageSource, /accessToken.*returnUrl|state.*returnUrl/);
assert.match(pageSource, /const \[repositoryPage, setRepositoryPage\] = useState\(1\)/);
assert.match(
  pageSource,
  /listGithubRepositories\(workspaceId, \{[\s\S]{0,160}page: repositoryPage/
);
assert.match(pageSource, /repositoryPage > 1/);
assert.match(pageSource, /repositoriesTotal > repositoryPage \* REPOSITORIES_PER_PAGE/);
assert.match(pageSource, /createRepositoryPageRequestGate/);
assert.match(pageSource, /requestGate\.isCurrent\(requestGeneration\)/);

await import("./source-sync-polling.test.mjs");
await import("./repository-page-request-gate.test.mjs");
