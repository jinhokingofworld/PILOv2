import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const boardRoot = new URL("./", import.meta.url);
const githubIntegrationImportPattern =
  /(?:@\/features\/github-integration|(?:\.\.\/)+github-integration)(?:\/|["'])/;

async function readProductionSources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const sources = [];

  for (const entry of entries) {
    const entryUrl = new URL(entry.name, directory);

    if (entry.isDirectory()) {
      sources.push(
        ...(await readProductionSources(new URL(`${entry.name}/`, directory)))
      );
      continue;
    }

    if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) {
      continue;
    }

    sources.push({
      path: fileURLToPath(entryUrl),
      source: await readFile(entryUrl, "utf8")
    });
  }

  return sources;
}

const violations = (await readProductionSources(boardRoot))
  .filter(({ source }) => githubIntegrationImportPattern.test(source))
  .map(({ path }) => path);

assert.deepEqual(
  violations,
  [],
  `Board must not import GitHub Integration feature internals:\n${violations.join("\n")}`
);
