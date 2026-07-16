import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const navigation = await readFile(
  new URL("../navigation.ts", import.meta.url),
  "utf8"
);
const githubPage = await readFile(new URL("./page.tsx", import.meta.url), "utf8");

assert.doesNotMatch(navigation, /githubIntegrationNavigation/);
assert.doesNotMatch(githubPage, /<GithubPanel/);
assert.match(githubPage, /buildGithubSettingsCompatibilityPath/);
assert.match(githubPage, /router\.replace/);
