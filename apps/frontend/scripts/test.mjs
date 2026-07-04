import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const navigationFiles = await Promise.all(
  [
    "../src/features/calendar/navigation.ts",
    "../src/features/github-integration/navigation.ts",
    "../src/features/board/navigation.ts",
    "../src/features/pr-review/navigation.ts",
    "../src/features/meeting/navigation.ts",
    "../src/features/canvas/navigation.ts"
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8"))
);
const githubApiClient = await readFile(
  new URL("../src/features/github-integration/api/client.ts", import.meta.url),
  "utf8"
);
const routePages = await Promise.all(
  [
    "../src/app/calendar/page.tsx",
    "../src/app/github/page.tsx",
    "../src/app/board/page.tsx",
    "../src/app/pr-review/page.tsx",
    "../src/app/meeting/page.tsx",
    "../src/app/canvas/page.tsx"
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8"))
);
const featurePages = await Promise.all(
  [
    "../src/features/calendar/page.tsx",
    "../src/features/github-integration/page.tsx",
    "../src/features/board/page.tsx",
    "../src/features/pr-review/page.tsx",
    "../src/features/meeting/page.tsx",
    "../src/features/canvas/page.tsx"
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8"))
);
const navigation = navigationFiles.join("\n");
const routes = routePages.join("\n");
const pages = featurePages.join("\n");

assert.match(navigation, /Calendar/);
assert.match(navigation, /GitHub sync/);
assert.match(navigation, /Board/);
assert.match(navigation, /PR review/);
assert.match(navigation, /Voice meeting/);
assert.match(navigation, /Canvas/);
assert.match(githubApiClient, /\/api\/v1/);
assert.match(githubApiClient, /NEXT_PUBLIC_PILO_APP_SERVER_URL/);
assert.match(routes, /as default/);
assert.doesNotMatch(routes, /MainShell/);
assert.match(pages, /MainShell/);
assert.match(pages, /Panel/);
