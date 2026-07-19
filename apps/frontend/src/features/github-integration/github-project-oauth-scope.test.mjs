import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

let scopeModule;

try {
  scopeModule = await import("./utils/github-project-oauth-scope.ts");
} catch (error) {
  assert.fail(`GitHub ProjectV2 OAuth scope helper must exist: ${error}`);
}

const { hasRequiredGithubProjectOAuthScopes } = scopeModule;

for (const [scope, expected] of [
  [null, false],
  ["", false],
  ["project", false],
  ["repo", false],
  ["read:user,user:email,project,repo", true],
  ["read:user user:email, project\trepo", true]
]) {
  assert.equal(
    hasRequiredGithubProjectOAuthScopes(scope),
    expected,
    `scope ${JSON.stringify(scope)} should ${expected ? "pass" : "fail"}`
  );
}

const [panel, layout, project, steps] = await Promise.all([
  readFile(new URL("./components/github-panel.tsx", import.meta.url), "utf8"),
  readFile(
    new URL("./components/github-connect-layout.tsx", import.meta.url),
    "utf8"
  ),
  readFile(
    new URL("./components/github-connect-project.tsx", import.meta.url),
    "utf8"
  ),
  readFile(
    new URL("./components/github-connect-steps.tsx", import.meta.url),
    "utf8"
  )
]);

for (const component of [panel, steps]) {
  assert.match(component, /hasRequiredGithubProjectOAuthScopes/);
}

assert.match(layout, /hasRequiredGithubProjectOAuthScopes/);
assert.match(
  layout,
  /projectOAuthConnected=\{projectOAuth\?\.connected === true && projectOAuthHasRequiredScopes\}/
);
assert.match(project, /projectOAuthConnected: boolean/);

assert.doesNotMatch(panel, /function hasProjectScope/);
assert.match(
  panel,
  /GitHub ProjectV2 OAuth connection must be reconnected with project and repo scopes/
);
assert.match(panel, /project와 repo 권한이 모두 필요합니다/);
assert.match(steps, /Project 작업 권한 재연결/);
assert.match(
  steps,
  /projectOAuth\?\.connected === true\s*&&\s*projectOAuthHasRequiredScopes/
);
assert.match(steps, /Project 작업 권한 연결/);

console.log("GitHub ProjectV2 OAuth scope tests passed");
