import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const migrationDirectory = "db/migrations";
const baseRef = process.env.MIGRATION_BASE_REF || "origin/dev";
const migrationPattern = /^(\d{3})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;
function git(...args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
}

const migrationFiles = (await readdir(path.join(repositoryRoot, migrationDirectory)))
  .filter((file) => file.endsWith(".sql"))
  .sort();
const migrationVersions = new Set();

for (const file of migrationFiles) {
  assert.match(file, migrationPattern, `Invalid migration filename: ${file}`);
  const version = Number(file.slice(0, 3));
  assert.ok(!migrationVersions.has(version), `Duplicate migration version: ${version}`);
  migrationVersions.add(version);
}

const changedEntries = git(
  "diff",
  "--name-status",
  "--find-renames",
  `${baseRef}...HEAD`,
  "--",
  migrationDirectory,
)
  .split("\n")
  .filter(Boolean)
  .map((line) => line.split("\t"));

const addedFiles = [];
for (const [status, firstPath, secondPath] of changedEntries) {
  if (status === "A") {
    addedFiles.push(firstPath);
    continue;
  }

  throw new Error(`Existing migrations are immutable. ${status} change is not allowed: ${secondPath || firstPath}`);
}

if (addedFiles.length > 0) {
  const baseFiles = git("ls-tree", "-r", "--name-only", baseRef, migrationDirectory)
    .split("\n")
    .filter(Boolean)
    .map((file) => path.basename(file));
  const baseVersions = baseFiles.map((file) => {
    const match = file.match(migrationPattern);
    assert.ok(match, `Invalid existing migration filename: ${file}`);
    return Number(match[1]);
  });
  const nextVersion = Math.max(...baseVersions, 0) + 1;
  const addedVersions = addedFiles
    .map((file) => path.basename(file).match(migrationPattern))
    .map((match, index) => {
      assert.ok(match, `Invalid added migration filename: ${path.basename(addedFiles[index])}`);
      return Number(match[1]);
    })
    .sort((left, right) => left - right);

  assert.deepEqual(
    addedVersions,
    Array.from({ length: addedVersions.length }, (_, index) => nextVersion + index),
    "New migrations must use consecutive versions starting after the current dev maximum.",
  );
}

console.log("DB migration change policy is verified.");
