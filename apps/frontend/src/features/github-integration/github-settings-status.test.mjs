import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const settingsDialog = await readFile(
  new URL("../settings/components/user-settings-dialog.tsx", import.meta.url),
  "utf8"
);
const appSidebar = await readFile(
  new URL("../../components/app-sidebar.tsx", import.meta.url),
  "utf8"
);
const layout = await readFile(
  new URL("./components/github-connect-layout.tsx", import.meta.url),
  "utf8"
);
const primitives = await readFile(
  new URL("./components/github-connect-primitives.tsx", import.meta.url),
  "utf8"
);
const steps = await readFile(
  new URL("./components/github-connect-steps.tsx", import.meta.url),
  "utf8"
);
const tables = await readFile(
  new URL("./components/github-connect-tables.tsx", import.meta.url),
  "utf8"
);

assert.match(appSidebar, /<GithubPanel\s*\/>/);
assert.doesNotMatch(appSidebar, /GithubSettingsStatus/);
assert.match(settingsDialog, /initialSection\?: SettingsDialogSectionId/);
assert.match(settingsDialog, /activeSection === "github" \? githubContent : null/);
assert.match(layout, /@container/);
assert.doesNotMatch(layout, /min-h-\[calc\(100vh-3\.5rem\)\]/);
assert.match(primitives, /@\/components\/ui\/card/);
assert.match(primitives, /@\/components\/ui\/badge/);
assert.doesNotMatch(steps, /md:grid-cols-3/);
assert.match(steps, /@\[48rem\]:grid-cols-3/);
assert.doesNotMatch(tables, /max-\[760px\]/);
assert.equal((tables.match(/@\[48rem\]:grid-cols-/g) ?? []).length, 4);
