import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { GithubAppClient } = require(
  "../../dist/modules/github-integration/github-app.client.js"
);
const { GithubConflictMergeService } = require(
  "../../dist/modules/github-integration/github-conflict-merge.service.js"
);
const { GithubGitCommandError, GithubGitCommandRunner } = require(
  "../../dist/modules/github-integration/github-git-command-runner.js"
);
const { GithubPullRequestFileWriteService } = require(
  "../../dist/modules/github-integration/github-pull-request-file-write.service.js"
);

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function normalizeLineEndings(value) {
  return value.replace(/\r\n/g, "\n");
}

async function writeRepositoryFile(repository, path, content) {
  const target = join(repository, ...path.split("/"));
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, content, "utf8");
}

async function createConflictFixture({ multipleConflicts = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "pilo-git-merge-test-"));
  const remote = join(root, "remote.git");
  const seed = join(root, "seed");
  await mkdir(seed);
  git(root, ["init", "--bare", remote]);
  git(seed, ["init"]);
  git(seed, ["config", "user.name", "PILO Test"]);
  git(seed, ["config", "user.email", "pilo-test@example.com"]);

  await writeRepositoryFile(
    seed,
    "src/conflicted.ts",
    "export function summarize(value: string) {\n  return `value:${value}`;\n}\n"
  );
  await writeRepositoryFile(
    seed,
    "config/runtime.ts",
    "export const requestTimeoutSeconds = 30;\n"
  );
  if (multipleConflicts) {
    await writeRepositoryFile(
      seed,
      "src/secondary.ts",
      "export const secondaryMode = \"shared\";\n"
    );
  }

  git(seed, ["add", "."]);
  git(seed, ["commit", "-m", "Initial project"]);
  git(seed, ["branch", "dev"]);
  git(seed, ["branch", "feature/conflict"]);
  git(seed, ["remote", "add", "origin", remote]);
  git(seed, ["push", "origin", "dev", "feature/conflict"]);

  git(seed, ["checkout", "feature/conflict"]);
  await writeRepositoryFile(
    seed,
    "src/conflicted.ts",
    "export function summarize(value: string) {\n  return `head:${value.toUpperCase()}`;\n}\n"
  );
  if (multipleConflicts) {
    await writeRepositoryFile(
      seed,
      "src/secondary.ts",
      "export const secondaryMode = \"head\";\n"
    );
  }
  git(seed, ["add", "."]);
  git(seed, ["commit", "-m", "Change PR behavior"]);
  git(seed, ["push", "origin", "feature/conflict"]);
  const headSha = git(seed, ["rev-parse", "HEAD"]);

  git(seed, ["checkout", "dev"]);
  await writeRepositoryFile(
    seed,
    "src/conflicted.ts",
    "export function summarize(value: string) {\n  return `base:${value.trim()}`;\n}\n"
  );
  await writeRepositoryFile(
    seed,
    "config/runtime.ts",
    "export const requestTimeoutSeconds = 45;\n"
  );
  if (multipleConflicts) {
    await writeRepositoryFile(
      seed,
      "src/secondary.ts",
      "export const secondaryMode = \"base\";\n"
    );
  }
  git(seed, ["add", "."]);
  git(seed, ["commit", "-m", "Change target behavior"]);
  git(seed, ["push", "origin", "dev"]);
  const baseSha = git(seed, ["rev-parse", "HEAD"]);

  return { baseSha, headSha, remote, root, seed };
}

async function applyFixtureResolution(fixture, { includeSecondary = false } = {}) {
  const service = new GithubConflictMergeService(new GithubGitCommandRunner());
  return service.createConflictMergeCommit({
    accessToken: "test-token",
    authorName: "Developer-EJ",
    baseBranch: "dev",
    baseRepositoryUrl: fixture.remote,
    baseSha: fixture.baseSha,
    files: [
      {
        content:
          "export function summarize(value: string) {\n  return `resolved:${value.trim().toUpperCase()}`;\n}\n",
        path: "src/conflicted.ts"
      },
      ...(includeSecondary
        ? [
            {
              content: "export const secondaryMode = \"resolved\";\n",
              path: "src/secondary.ts"
            }
          ]
        : [])
    ],
    headBranch: "feature/conflict",
    headRepositoryUrl: fixture.remote,
    headSha: fixture.headSha,
    message: includeSecondary
      ? "Resolve conflicts in 2 files"
      : "Resolve conflict in src/conflicted.ts"
  });
}

{
  const service = new GithubConflictMergeService({
    async run(input) {
      if (input.args[0] === "check-ref-format") {
        return { stdout: "", stderr: "" };
      }
      throw new GithubGitCommandError(
        128,
        "",
        "fatal: unable to access repository: returned error: 403",
        false
      );
    }
  });

  await assert.rejects(
    () =>
      service.createConflictMergeCommit({
        accessToken: "test-token",
        authorName: "Developer-EJ",
        baseBranch: "dev",
        baseRepositoryUrl: "https://github.com/Developer-EJ/PILO.git",
        baseSha: "b".repeat(40),
        files: [
          {
            content: "const resolved = true;\n",
            path: "src/conflicted.ts"
          }
        ],
        headBranch: "feature/conflict",
        headRepositoryUrl: "https://github.com/Developer-EJ/PILO.git",
        headSha: "a".repeat(40),
        message: "Resolve conflict in src/conflicted.ts"
      }),
    (error) => {
      assert.equal(error?.getStatus?.(), 403);
      assert.equal(
        error?.response?.error?.message,
        "GitHub App Contents read permission is required"
      );
      assert.doesNotMatch(JSON.stringify(error?.response), /returned error/);
      return true;
    }
  );
}

{
  const fixture = await createConflictFixture();
  try {
    const result = await applyFixtureResolution(fixture);
    const verification = join(fixture.root, "verification");
    git(fixture.root, [
      "clone",
      "--branch",
      "feature/conflict",
      fixture.remote,
      verification
    ]);

    assert.equal(git(verification, ["rev-parse", "HEAD"]), result.commitSha);
    assert.equal(
      normalizeLineEndings(
        await readFile(join(verification, "src", "conflicted.ts"), "utf8")
      ),
      "export function summarize(value: string) {\n  return `resolved:${value.trim().toUpperCase()}`;\n}\n"
    );
    assert.equal(
      normalizeLineEndings(
        await readFile(join(verification, "config", "runtime.ts"), "utf8")
      ),
      "export const requestTimeoutSeconds = 45;\n"
    );

    const commitAndParents = git(verification, [
      "rev-list",
      "--parents",
      "-n",
      "1",
      "HEAD"
    ]).split(/\s+/);
    assert.deepEqual(commitAndParents, [
      result.commitSha,
      fixture.headSha,
      fixture.baseSha
    ]);
    assert.equal(
      git(verification, ["rev-parse", "HEAD:src/conflicted.ts"]),
      result.files.find((file) => file.path === "src/conflicted.ts")?.contentSha
    );
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
}

{
  const fixture = await createConflictFixture({ multipleConflicts: true });
  try {
    await assert.rejects(
      () => applyFixtureResolution(fixture),
      (error) => {
        assert.equal(error?.getStatus?.(), 409);
        assert.equal(
          error?.response?.error?.message,
          "GitHub pull request conflicted file set is stale"
        );
        return true;
      }
    );
    assert.equal(
      git(fixture.root, [
        "--git-dir",
        fixture.remote,
        "rev-parse",
        "refs/heads/feature/conflict"
      ]),
      fixture.headSha
    );

    const result = await applyFixtureResolution(fixture, {
      includeSecondary: true
    });
    const verification = join(fixture.root, "multi-file-verification");
    git(fixture.root, [
      "clone",
      "--branch",
      "feature/conflict",
      fixture.remote,
      verification
    ]);
    assert.equal(git(verification, ["rev-parse", "HEAD"]), result.commitSha);
    assert.equal(
      normalizeLineEndings(
        await readFile(join(verification, "src", "secondary.ts"), "utf8")
      ),
      "export const secondaryMode = \"resolved\";\n"
    );
    assert.deepEqual(
      result.files.map((file) => file.path).sort(),
      ["src/conflicted.ts", "src/secondary.ts"]
    );
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
}

{
  const fixture = await createConflictFixture();
  try {
    git(fixture.seed, ["checkout", "feature/conflict"]);
    await writeRepositoryFile(
      fixture.seed,
      "src/unrelated.ts",
      "export const unrelated = true;\n"
    );
    git(fixture.seed, ["add", "."]);
    git(fixture.seed, ["commit", "-m", "Advance PR branch"]);
    git(fixture.seed, ["push", "origin", "feature/conflict"]);

    await assert.rejects(
      () => applyFixtureResolution(fixture),
      (error) => {
        assert.equal(error?.getStatus?.(), 409);
        assert.equal(
          error?.response?.error?.message,
          "GitHub pull request head SHA is stale"
        );
        return true;
      }
    );
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
}

{
  const fixture = await createConflictFixture();
  try {
    await writeRepositoryFile(
      fixture.seed,
      "config/base-only.ts",
      "export const baseOnly = true;\n"
    );
    git(fixture.seed, ["add", "."]);
    git(fixture.seed, ["commit", "-m", "Advance target branch"]);
    git(fixture.seed, ["push", "origin", "dev"]);

    await assert.rejects(
      () => applyFixtureResolution(fixture),
      (error) => {
        assert.equal(error?.getStatus?.(), 409);
        assert.equal(
          error?.response?.error?.message,
          "GitHub pull request base SHA is stale"
        );
        return true;
      }
    );
    assert.equal(
      git(fixture.root, [
        "--git-dir",
        fixture.remote,
        "rev-parse",
        "refs/heads/feature/conflict"
      ]),
      fixture.headSha
    );
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
}

{
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async (url, options = {}) => {
    requestCount += 1;
    assert.doesNotMatch(url.toString(), /access_tokens/);
    assert.equal(options.headers.Authorization, "Bearer shared-installation-token");

    if (requestCount === 1) {
      return {
        ok: false,
        status: 503,
        headers: new Headers()
      };
    }

    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      async json() {
        return {
          type: "file",
          path: "src/conflicted.ts",
          sha: "head-blob-sha",
          size: 22,
          encoding: "base64",
          content: Buffer.from("const head = true;", "utf8").toString("base64")
        };
      }
    };
  };

  try {
    const result = await new GithubAppClient().getRepositoryFileContent({
      installationId: 145648993,
      installationAccessToken: "shared-installation-token",
      appId: "unused",
      privateKey: "unused",
      owner: "Developer-EJ",
      repo: "PILO",
      path: "src/conflicted.ts",
      ref: "head-sha"
    });

    assert.equal(requestCount, 2);
    assert.equal(result.sha, "head-blob-sha");
    assert.equal(result.content, "const head = true;");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return {
      ok: false,
      status: 403,
      headers: new Headers({ "x-ratelimit-remaining": "0" })
    };
  };

  try {
    await assert.rejects(
      () =>
        new GithubAppClient().getRepositoryFileContent({
          installationId: 145648993,
          installationAccessToken: "shared-installation-token",
          appId: "unused",
          privateKey: "unused",
          owner: "Developer-EJ",
          repo: "PILO",
          path: "src/conflicted.ts",
          ref: "head-sha"
        }),
      (error) => {
        assert.equal(error?.getStatus?.(), 400);
        assert.equal(
          error?.response?.error?.message,
          "GitHub repository file lookup is temporarily unavailable"
        );
        return true;
      }
    );
    assert.equal(requestCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

class FakeDatabase {
  constructor({ failCacheUpdate = false } = {}) {
    this.failCacheUpdate = failCacheUpdate;
    this.queries = [];
  }

  async queryOne(text, values = []) {
    this.queries.push({ text, values });

    if (text.includes("FROM users")) {
      return {
        github_login: "Developer-EJ",
        github_access_token_encrypted: "encrypted-token",
        github_connected_at: "2026-07-10T00:00:00.000Z",
        github_revoked_at: null
      };
    }

    if (text.includes("FROM github_pull_requests AS pr")) {
      return {
        id: "pull-request-id",
        pr_number: 561,
        owner_login: "Developer-EJ",
        name: "PILO",
        github_installation_id: 145648993
      };
    }

    if (text.includes("UPDATE github_pull_requests")) {
      if (this.failCacheUpdate) {
        throw new Error("database unavailable");
      }

      return { id: "pull-request-id" };
    }

    return null;
  }
}

function createFileWriteService(database, mergeRequests) {
  return new GithubPullRequestFileWriteService(
    database,
    {
      async getPullRequest() {
        return {
          headSha: "head-sha",
          baseRef: "dev",
          baseSha: "base-sha",
          headRef: "feature/conflict",
          headRepositoryOwner: "Developer-EJ",
          headRepositoryName: "PILO"
        };
      }
    },
    {
      async createConflictMergeCommit(input) {
        mergeRequests.push(input);
        return {
          commitSha: "merge-commit-sha",
          files: input.files.map((file) => ({
            contentSha: "resolved-blob-sha",
            path: file.path
          }))
        };
      }
    },
    {
      decryptToken() {
        return "user-oauth-token";
      }
    },
    {
      getGithubOAuthConfig() {
        return { tokenEncryptionKey: "test-key" };
      },
      getGithubAppConfig() {
        return {
          appId: "12345",
          privateKey: "private-key"
        };
      }
    },
    {
      async assertWorkspaceAccess() {}
    }
  );
}

for (const { failCacheUpdate, expectedCacheUpdated } of [
  { failCacheUpdate: false, expectedCacheUpdated: true },
  { failCacheUpdate: true, expectedCacheUpdated: false }
]) {
  const database = new FakeDatabase({ failCacheUpdate });
  const mergeRequests = [];
  const service = createFileWriteService(database, mergeRequests);
  const result = await service.applyGithubPullRequestFileResolution(
    "user-id",
    "workspace-id",
    "pull-request-id",
    {
      filePath: "src/conflicted.ts",
      resolvedContent: "const resolved = true;",
      expectedBaseSha: "base-sha",
      expectedHeadSha: "head-sha",
      expectedHeadBlobSha: "head-blob-sha"
    }
  );

  assert.deepEqual(mergeRequests[0], {
    accessToken: "user-oauth-token",
    authorName: "Developer-EJ",
    baseBranch: "dev",
    baseRepositoryUrl: "https://github.com/Developer-EJ/PILO.git",
    baseSha: "base-sha",
    files: [
      {
        content: "const resolved = true;",
        path: "src/conflicted.ts"
      }
    ],
    headBranch: "feature/conflict",
    headRepositoryUrl: "https://github.com/Developer-EJ/PILO.git",
    headSha: "head-sha",
    message: "Resolve conflict in src/conflicted.ts"
  });
  assert.equal(result.localCacheUpdated, expectedCacheUpdated);
  assert.equal(
    result.commitUrl,
    "https://github.com/Developer-EJ/PILO/commit/merge-commit-sha"
  );
  const cacheUpdate = database.queries.find((query) =>
    query.text.includes("UPDATE github_pull_requests")
  );
  assert.ok(cacheUpdate);
  assert.doesNotMatch(cacheUpdate.text, /head_sha\s*=/i);
  assert.match(cacheUpdate.text, /\{head,sha\}/);
}

{
  const database = new FakeDatabase();
  const mergeRequests = [];
  const service = createFileWriteService(database, mergeRequests);
  const result = await service.applyGithubPullRequestConflictResolutions(
    "user-id",
    "workspace-id",
    "pull-request-id",
    {
      expectedBaseSha: "base-sha",
      expectedHeadSha: "head-sha",
      files: [
        {
          filePath: "src/conflicted.ts",
          resolvedContent: "const resolved = true;",
          expectedHeadBlobSha: "first-head-blob-sha"
        },
        {
          filePath: "src/secondary.ts",
          resolvedContent: "const secondary = true;",
          expectedHeadBlobSha: "second-head-blob-sha"
        }
      ]
    }
  );

  assert.deepEqual(mergeRequests[0].files, [
    {
      content: "const resolved = true;",
      path: "src/conflicted.ts"
    },
    {
      content: "const secondary = true;",
      path: "src/secondary.ts"
    }
  ]);
  assert.equal(mergeRequests[0].message, "Resolve conflicts in 2 files");
  assert.deepEqual(result.files, [
    {
      filePath: "src/conflicted.ts",
      headBlobShaBefore: "first-head-blob-sha",
      headBlobShaAfter: "resolved-blob-sha"
    },
    {
      filePath: "src/secondary.ts",
      headBlobShaBefore: "second-head-blob-sha",
      headBlobShaAfter: "resolved-blob-sha"
    }
  ]);
}

console.log("GitHub conflict merge tests passed");
