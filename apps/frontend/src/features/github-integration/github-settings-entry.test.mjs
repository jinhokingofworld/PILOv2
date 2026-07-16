import assert from "node:assert/strict";

import {
  buildGithubSettingsCompatibilityPath,
  buildGithubSettingsReturnUrl,
  isGithubSettingsEntry
} from "./utils/github-settings-entry.ts";

assert.equal(
  buildGithubSettingsReturnUrl("https://dev.pilo.my/calendar?view=month#today"),
  "https://dev.pilo.my/calendar?view=month&settings=github#today"
);
assert.equal(
  isGithubSettingsEntry(new URLSearchParams("settings=github")),
  true
);
assert.equal(
  buildGithubSettingsCompatibilityPath(
    "?github_callback_error=authorization_cancelled&github_installation_id=7"
  ),
  "/home?github_callback_error=authorization_cancelled&github_installation_id=7&settings=github"
);
