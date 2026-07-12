import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(
  new URL("./github-onboarding.ts", import.meta.url),
  "utf8"
);
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

const callback = onboarding.readGithubOnboardingCallback(
  new URLSearchParams(
    "workspaceId=workspace-1&github_onboarding_step=installation&github_installation_id=installation-7&github_callback_error=authorization_cancelled"
  )
);

assert.deepEqual(callback, {
  workspaceId: "workspace-1",
  step: "installation",
  installationId: "installation-7",
  repositoryId: null,
  callbackError: "authorization_cancelled"
});

assert.equal(
  onboarding.createGithubOnboardingReturnUrl("workspace-1", "project-oauth"),
  "/workspace/new?workspaceId=workspace-1&github_onboarding_step=project-oauth"
);

assert.equal(
  onboarding.createGithubOnboardingReturnUrl("workspace-1", "projects", "installation-7", "repository-9"),
  "/workspace/new?workspaceId=workspace-1&github_onboarding_step=projects&github_installation_id=installation-7&repositoryId=repository-9"
);
assert.match(pageSource, /startGithubAppInstallation\(existingWorkspaceId/);
assert.match(pageSource, /startGithubProjectOAuth/);
assert.match(pageSource, /setStage\("project-oauth"\)/);
assert.match(pageSource, /ProjectV2 권한 동의/);
assert.match(pageSource, /나중에 연결/);
assert.match(pageSource, /callback\.step !== "project-oauth"/);
assert.match(pageSource, /callback\.callbackError \? "project-oauth"/);
assert.match(pageSource, /router\.replace\("\/home"\)/);
assert.match(pageSource, /GitHub 다시 연결/);
assert.match(pageSource, /router\.replace\(createGithubOnboardingReturnUrl\(workspace\.id, "oauth"\)\)/);
assert.match(pageSource, /if \(workspaceId\) \{ await resumeGithub\(workspaceId\); return; \}/);
assert.match(pageSource, /resumeGithub.*catch|async function resumeGithub[\s\S]*setMessage/);
assert.match(pageSource, /icon: workspaceIcon/);
assert.match(pageSource, /projectIds\.length === 0/);
assert.doesNotMatch(pageSource, /accessToken.*returnUrl|state.*returnUrl/);
assert.equal(
  onboarding.createGithubOnboardingReturnUrl(
    "workspace 1",
    "repositories",
    "installation 7"
  ),
  "/workspace/new?workspaceId=workspace+1&github_onboarding_step=repositories&github_installation_id=installation+7"
);

assert.equal(
  onboarding.readGithubOnboardingCallback(
    new URLSearchParams("workspaceId=&access_token=secret&state=state")
  ).workspaceId,
  null
);
assert.equal(onboarding.getGithubOnboardingStep("not-a-step"), "oauth");
assert.equal(
  onboarding.getGithubCallbackErrorMessage("project_oauth_account_mismatch"),
  "ProjectV2 권한은 GitHub App 연결에 사용한 동일한 계정으로 승인해 주세요."
);
