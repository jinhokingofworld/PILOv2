import { lstat, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { Injectable } from "@nestjs/common";
import {
  badRequest,
  conflict as conflictError,
  forbidden
} from "../../common/api-error";
import {
  GithubGitCommandError,
  GithubGitCommandRunner
} from "./github-git-command-runner";

const GIT_CLONE_TIMEOUT_MS = 300_000;
const GIT_NETWORK_TIMEOUT_MS = 180_000;
const GIT_SHA_PATTERN = /^[0-9a-f]{40,64}$/i;

export interface GithubConflictMergeFileRequest {
  content: string;
  path: string;
}

export interface GithubConflictMergeRequest {
  accessToken: string;
  authorName: string;
  baseBranch: string;
  baseRepositoryUrl: string;
  baseSha: string;
  files: GithubConflictMergeFileRequest[];
  headBranch: string;
  headRepositoryUrl: string;
  headSha: string;
  message: string;
}

export interface GithubConflictMergeFileResponse {
  contentSha: string;
  path: string;
}

export interface GithubConflictMergeResponse {
  commitSha: string;
  files: GithubConflictMergeFileResponse[];
}

@Injectable()
export class GithubConflictMergeService {
  constructor(private readonly git: GithubGitCommandRunner) {}

  async createConflictMergeCommit(
    input: GithubConflictMergeRequest
  ): Promise<GithubConflictMergeResponse> {
    const files = this.normalizeConflictFiles(input.files);
    this.assertCommitSha(input.headSha);
    this.assertCommitSha(input.baseSha);
    await this.assertBranchName(input.headBranch);
    await this.assertBranchName(input.baseBranch);

    const temporaryRoot = await mkdtemp(join(tmpdir(), "pilo-pr-conflict-"));
    const repositoryDirectory = join(temporaryRoot, "repository");
    const authenticationEnvironment = this.createAuthenticationEnvironment(
      input.accessToken
    );

    try {
      await this.cloneHeadRepository({
        authenticationEnvironment,
        branch: input.headBranch,
        repositoryDirectory,
        repositoryUrl: input.headRepositoryUrl
      });
      await this.assertRemoteHeadSha(
        repositoryDirectory,
        input.headBranch,
        input.headSha
      );
      await this.fetchBaseCommit({
        authenticationEnvironment,
        baseRepositoryUrl: input.baseRepositoryUrl,
        baseSha: input.baseSha,
        headRepositoryUrl: input.headRepositoryUrl,
        repositoryDirectory
      });
      await this.prepareConflictMerge({
        authenticationEnvironment,
        authorName: input.authorName,
        baseSha: input.baseSha,
        filePaths: files.map((file) => file.path),
        headSha: input.headSha,
        repositoryDirectory
      });
      for (const file of files) {
        await this.writeResolvedFile(
          repositoryDirectory,
          file.path,
          file.content
        );
      }
      await this.finishConflictMerge({
        authenticationEnvironment,
        baseSha: input.baseSha,
        filePaths: files.map((file) => file.path),
        headSha: input.headSha,
        message: input.message,
        repositoryDirectory
      });
      const commitSha = await this.readCommitSha(
        repositoryDirectory,
        authenticationEnvironment
      );
      const resolvedFiles = await Promise.all(
        files.map(async (file) => ({
          contentSha: await this.readFileBlobSha(
            repositoryDirectory,
            file.path,
            authenticationEnvironment
          ),
          path: file.path
        }))
      );
      await this.assertRemoteHeadSha(
        repositoryDirectory,
        input.headBranch,
        input.headSha,
        authenticationEnvironment
      );
      await this.assertRemoteBaseSha({
        authenticationEnvironment,
        baseBranch: input.baseBranch,
        baseRepositoryUrl: input.baseRepositoryUrl,
        baseSha: input.baseSha,
        headRepositoryUrl: input.headRepositoryUrl,
        repositoryDirectory
      });
      await this.pushMergeCommit({
        authenticationEnvironment,
        branch: input.headBranch,
        commitSha,
        expectedHeadSha: input.headSha,
        repositoryDirectory
      });

      return {
        commitSha,
        files: resolvedFiles
      };
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  }

  private async cloneHeadRepository(input: {
    authenticationEnvironment: Record<string, string>;
    branch: string;
    repositoryDirectory: string;
    repositoryUrl: string;
  }): Promise<void> {
    try {
      await this.git.run({
        args: [
          "clone",
          "--no-checkout",
          "--filter=blob:none",
          "--single-branch",
          "--branch",
          input.branch,
          "--",
          input.repositoryUrl,
          input.repositoryDirectory
        ],
        env: input.authenticationEnvironment,
        timeoutMs: GIT_CLONE_TIMEOUT_MS
      });
    } catch (error) {
      this.throwGitRepositoryReadError(error);
    }
  }

  private async fetchBaseCommit(input: {
    authenticationEnvironment: Record<string, string>;
    baseRepositoryUrl: string;
    baseSha: string;
    headRepositoryUrl: string;
    repositoryDirectory: string;
  }): Promise<void> {
    const remoteName =
      input.baseRepositoryUrl === input.headRepositoryUrl ? "origin" : "base";

    if (remoteName === "base") {
      await this.runGitOrBadRequest(
        input.repositoryDirectory,
        ["remote", "add", remoteName, input.baseRepositoryUrl],
        "GitHub conflict merge preparation failed"
      );
      await this.runGitOrBadRequest(
        input.repositoryDirectory,
        ["config", `remote.${remoteName}.promisor`, "true"],
        "GitHub conflict merge preparation failed"
      );
      await this.runGitOrBadRequest(
        input.repositoryDirectory,
        ["config", `remote.${remoteName}.partialclonefilter`, "blob:none"],
        "GitHub conflict merge preparation failed"
      );
    }

    try {
      await this.git.run({
        args: [
          "fetch",
          "--no-tags",
          "--filter=blob:none",
          remoteName,
          input.baseSha
        ],
        cwd: input.repositoryDirectory,
        env: input.authenticationEnvironment,
        timeoutMs: GIT_NETWORK_TIMEOUT_MS
      });
    } catch (error) {
      this.throwGitRepositoryReadError(error);
    }

    await this.runGitOrBadRequest(
      input.repositoryDirectory,
      ["cat-file", "-e", `${input.baseSha}^{commit}`],
      "GitHub conflict base commit lookup failed"
    );
  }

  private async prepareConflictMerge(input: {
    authenticationEnvironment: Record<string, string>;
    authorName: string;
    baseSha: string;
    filePaths: string[];
    headSha: string;
    repositoryDirectory: string;
  }): Promise<void> {
    await this.runGitOrBadRequest(
      input.repositoryDirectory,
      ["checkout", "--detach", input.headSha],
      "GitHub conflict head checkout failed",
      input.authenticationEnvironment
    );
    await this.runGitOrBadRequest(
      input.repositoryDirectory,
      ["config", "user.name", input.authorName],
      "GitHub conflict merge preparation failed",
      input.authenticationEnvironment
    );
    await this.runGitOrBadRequest(
      input.repositoryDirectory,
      [
        "config",
        "user.email",
        `${this.normalizeAuthorName(input.authorName)}@users.noreply.github.com`
      ],
      "GitHub conflict merge preparation failed",
      input.authenticationEnvironment
    );

    let mergeError: GithubGitCommandError | null = null;
    try {
      await this.git.run({
        args: [
          "merge",
          "--no-commit",
          "--no-ff",
          "--no-edit",
          "--",
          input.baseSha
        ],
        cwd: input.repositoryDirectory,
        env: input.authenticationEnvironment
      });
    } catch (error) {
      if (!(error instanceof GithubGitCommandError)) {
        throw error;
      }
      mergeError = error;
    }

    const unmergedPaths = await this.readUnmergedPaths(
      input.repositoryDirectory,
      input.authenticationEnvironment
    );
    if (!mergeError) {
      throw conflictError("GitHub pull request conflict no longer exists");
    }

    if (mergeError.timedOut || unmergedPaths.length === 0) {
      throw badRequest("GitHub conflict merge preparation failed");
    }

    if (!this.haveSamePaths(unmergedPaths, input.filePaths)) {
      throw conflictError("GitHub pull request conflicted file set is stale");
    }
  }

  private async writeResolvedFile(
    repositoryDirectory: string,
    filePath: string,
    content: string
  ): Promise<void> {
    const repositoryRoot = await realpath(repositoryDirectory);
    const targetPath = resolve(repositoryRoot, ...filePath.split("/"));
    const targetRelativePath = relative(repositoryRoot, targetPath);
    if (
      !targetRelativePath ||
      targetRelativePath === ".." ||
      targetRelativePath.startsWith(`..${sep}`)
    ) {
      throw badRequest("Invalid GitHub repository file path");
    }

    const parentPath = await realpath(dirname(targetPath));
    const parentRelativePath = relative(repositoryRoot, parentPath);
    if (
      parentRelativePath === ".." ||
      parentRelativePath.startsWith(`..${sep}`)
    ) {
      throw badRequest("Invalid GitHub repository file path");
    }

    try {
      const targetStat = await lstat(targetPath);
      if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
        throw badRequest("GitHub conflict file type is not supported");
      }
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        throw badRequest("GitHub conflict file type is not supported");
      }
      throw error;
    }

    await writeFile(targetPath, content, "utf8");
  }

  private async finishConflictMerge(input: {
    authenticationEnvironment: Record<string, string>;
    baseSha: string;
    filePaths: string[];
    headSha: string;
    message: string;
    repositoryDirectory: string;
  }): Promise<void> {
    await this.runGitOrBadRequest(
      input.repositoryDirectory,
      ["add", "--", ...input.filePaths],
      "GitHub conflict resolution staging failed",
      input.authenticationEnvironment
    );

    const remainingUnmergedPaths = await this.readUnmergedPaths(
      input.repositoryDirectory,
      input.authenticationEnvironment
    );
    if (remainingUnmergedPaths.length > 0) {
      throw conflictError("GitHub pull request still has unresolved conflicts");
    }

    await this.runGitOrBadRequest(
      input.repositoryDirectory,
      ["rev-parse", "--verify", "MERGE_HEAD"],
      "GitHub conflict merge state is invalid",
      input.authenticationEnvironment
    );
    await this.runGitOrBadRequest(
      input.repositoryDirectory,
      ["commit", "--no-gpg-sign", "--no-verify", "-m", input.message],
      "GitHub conflict merge commit creation failed",
      input.authenticationEnvironment
    );

    const parentResult = await this.runGitOrBadRequest(
      input.repositoryDirectory,
      ["rev-list", "--parents", "-n", "1", "HEAD"],
      "GitHub conflict merge commit verification failed",
      input.authenticationEnvironment
    );
    const commitAndParents = parentResult.stdout.trim().split(/\s+/);
    if (
      commitAndParents.length !== 3 ||
      commitAndParents[1] !== input.headSha ||
      commitAndParents[2] !== input.baseSha
    ) {
      throw badRequest("GitHub conflict merge commit verification failed");
    }
  }

  private async pushMergeCommit(input: {
    authenticationEnvironment: Record<string, string>;
    branch: string;
    commitSha: string;
    expectedHeadSha: string;
    repositoryDirectory: string;
  }): Promise<void> {
    try {
      await this.git.run({
        args: [
          "push",
          "--porcelain",
          "origin",
          `HEAD:refs/heads/${input.branch}`
        ],
        cwd: input.repositoryDirectory,
        env: input.authenticationEnvironment,
        timeoutMs: GIT_NETWORK_TIMEOUT_MS
      });
    } catch (error) {
      const remoteHeadSha = await this.tryReadRemoteHeadSha(
        input.repositoryDirectory,
        input.branch,
        input.authenticationEnvironment
      );
      if (remoteHeadSha === input.commitSha) {
        return;
      }
      if (remoteHeadSha && remoteHeadSha !== input.expectedHeadSha) {
        throw conflictError("GitHub pull request head SHA is stale");
      }
      if (this.isStalePushError(error)) {
        throw conflictError("GitHub pull request head SHA is stale");
      }
      this.throwGitRepositoryWriteError(error);
    }
  }

  private async assertRemoteHeadSha(
    repositoryDirectory: string,
    branch: string,
    expectedHeadSha: string,
    authenticationEnvironment?: Record<string, string>
  ): Promise<void> {
    if (!authenticationEnvironment) {
      const result = await this.runGitOrBadRequest(
        repositoryDirectory,
        ["rev-parse", "--verify", `refs/remotes/origin/${branch}^{commit}`],
        "GitHub conflict head commit lookup failed"
      );
      if (result.stdout.trim() !== expectedHeadSha) {
        throw conflictError("GitHub pull request head SHA is stale");
      }
      return;
    }

    const currentHeadSha = await this.readRemoteBranchSha(
      repositoryDirectory,
      "origin",
      branch,
      authenticationEnvironment
    );
    if (currentHeadSha !== expectedHeadSha) {
      throw conflictError("GitHub pull request head SHA is stale");
    }
  }

  private async assertRemoteBaseSha(input: {
    authenticationEnvironment: Record<string, string>;
    baseBranch: string;
    baseRepositoryUrl: string;
    baseSha: string;
    headRepositoryUrl: string;
    repositoryDirectory: string;
  }): Promise<void> {
    const remoteName =
      input.baseRepositoryUrl === input.headRepositoryUrl ? "origin" : "base";
    const currentBaseSha = await this.readRemoteBranchSha(
      input.repositoryDirectory,
      remoteName,
      input.baseBranch,
      input.authenticationEnvironment
    );
    if (currentBaseSha !== input.baseSha) {
      throw conflictError("GitHub pull request base SHA is stale");
    }
  }

  private async readRemoteBranchSha(
    repositoryDirectory: string,
    remoteName: string,
    branch: string,
    authenticationEnvironment: Record<string, string>
  ): Promise<string> {
    try {
      const result = await this.git.run({
        args: ["ls-remote", remoteName, `refs/heads/${branch}`],
        cwd: repositoryDirectory,
        env: authenticationEnvironment,
        timeoutMs: GIT_NETWORK_TIMEOUT_MS
      });
      return result.stdout.trim().split(/\s+/)[0] ?? "";
    } catch (error) {
      this.throwGitRepositoryReadError(error);
    }
  }

  private async tryReadRemoteHeadSha(
    repositoryDirectory: string,
    branch: string,
    authenticationEnvironment: Record<string, string>
  ): Promise<string | null> {
    try {
      return await this.readRemoteBranchSha(
        repositoryDirectory,
        "origin",
        branch,
        authenticationEnvironment
      );
    } catch {
      return null;
    }
  }

  private async readUnmergedPaths(
    repositoryDirectory: string,
    authenticationEnvironment: Record<string, string>
  ): Promise<string[]> {
    const result = await this.runGitOrBadRequest(
      repositoryDirectory,
      ["diff", "--name-only", "--diff-filter=U", "-z"],
      "GitHub conflict merge state lookup failed",
      authenticationEnvironment
    );
    return result.stdout.split("\0").filter(Boolean);
  }

  private async readCommitSha(
    repositoryDirectory: string,
    authenticationEnvironment: Record<string, string>
  ): Promise<string> {
    const result = await this.runGitOrBadRequest(
      repositoryDirectory,
      ["rev-parse", "--verify", "HEAD"],
      "GitHub conflict merge commit lookup failed",
      authenticationEnvironment
    );
    return result.stdout.trim();
  }

  private async readFileBlobSha(
    repositoryDirectory: string,
    filePath: string,
    authenticationEnvironment: Record<string, string>
  ): Promise<string> {
    const result = await this.runGitOrBadRequest(
      repositoryDirectory,
      ["ls-tree", "-z", "HEAD", "--", filePath],
      "GitHub conflict file lookup failed",
      authenticationEnvironment
    );
    const match = result.stdout.match(/^[0-7]{6} blob ([0-9a-f]+)\t/);
    if (!match) {
      throw badRequest("GitHub conflict file lookup failed");
    }
    return match[1];
  }

  private async assertBranchName(branch: string): Promise<void> {
    if (!branch || /[\0\r\n]/.test(branch)) {
      throw badRequest("Invalid GitHub pull request head branch");
    }

    try {
      await this.git.run({ args: ["check-ref-format", "--branch", branch] });
    } catch {
      throw badRequest("Invalid GitHub pull request head branch");
    }
  }

  private assertCommitSha(sha: string): void {
    if (!GIT_SHA_PATTERN.test(sha)) {
      throw badRequest("Invalid GitHub commit SHA");
    }
  }

  private normalizeRepositoryPath(filePath: string): string {
    if (!filePath || filePath.includes("\\") || /[\0\r\n]/.test(filePath)) {
      throw badRequest("Invalid GitHub repository file path");
    }

    const parts = filePath.split("/");
    if (
      parts.some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          part.toLowerCase() === ".git"
      )
    ) {
      throw badRequest("Invalid GitHub repository file path");
    }

    return parts.join("/");
  }

  private normalizeConflictFiles(
    files: GithubConflictMergeFileRequest[]
  ): GithubConflictMergeFileRequest[] {
    if (!Array.isArray(files) || files.length === 0) {
      throw badRequest("GitHub conflict files must not be empty");
    }

    const normalizedFiles = files.map((file) => ({
      content: file.content,
      path: this.normalizeRepositoryPath(file.path)
    }));
    const uniquePaths = new Set(normalizedFiles.map((file) => file.path));
    if (uniquePaths.size !== normalizedFiles.length) {
      throw badRequest("GitHub conflict file paths must be unique");
    }

    return normalizedFiles;
  }

  private haveSamePaths(
    actualPaths: string[],
    expectedPaths: string[]
  ): boolean {
    if (actualPaths.length !== expectedPaths.length) {
      return false;
    }

    const sortedActual = [...actualPaths].sort();
    const sortedExpected = [...expectedPaths].sort();
    return sortedActual.every((path, index) => path === sortedExpected[index]);
  }

  private normalizeAuthorName(authorName: string): string {
    const normalized = authorName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    return normalized || "pilo-pr-review";
  }

  private createAuthenticationEnvironment(
    accessToken: string
  ): Record<string, string> {
    const basicCredential = Buffer.from(
      `x-access-token:${accessToken}`,
      "utf8"
    ).toString("base64");

    return {
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "http.extraHeader",
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${basicCredential}`,
      GIT_CONFIG_KEY_1: "credential.helper",
      GIT_CONFIG_VALUE_1: "",
      GIT_LFS_SKIP_SMUDGE: "1",
      GIT_TERMINAL_PROMPT: "0"
    };
  }

  private async runGitOrBadRequest(
    cwd: string,
    args: string[],
    message: string,
    env?: Record<string, string>
  ) {
    try {
      return await this.git.run({ args, cwd, env });
    } catch {
      throw badRequest(message);
    }
  }

  private throwGitRepositoryReadError(error: unknown): never {
    if (this.isAuthenticationError(error)) {
      throw badRequest("GitHub OAuth connection is invalid");
    }
    if (this.isPermissionError(error)) {
      throw forbidden("GitHub App Contents read permission is required");
    }
    throw badRequest("GitHub repository content lookup failed");
  }

  private throwGitRepositoryWriteError(error: unknown): never {
    if (this.isAuthenticationError(error)) {
      throw badRequest("GitHub OAuth connection is invalid");
    }
    if (this.isPermissionError(error)) {
      throw forbidden("GitHub App Contents write permission is required");
    }
    throw badRequest("GitHub conflict merge commit apply failed");
  }

  private isAuthenticationError(error: unknown): boolean {
    const output = this.readGitErrorOutput(error);
    return (
      output.includes("authentication failed") ||
      output.includes("could not read username") ||
      output.includes("http 401") ||
      output.includes("returned error: 401")
    );
  }

  private isPermissionError(error: unknown): boolean {
    const output = this.readGitErrorOutput(error);
    return (
      output.includes("permission denied") ||
      output.includes("write access") ||
      output.includes("http 403") ||
      output.includes("returned error: 403")
    );
  }

  private isStalePushError(error: unknown): boolean {
    const output = this.readGitErrorOutput(error);
    return (
      output.includes("non-fast-forward") ||
      output.includes("fetch first") ||
      output.includes("stale info")
    );
  }

  private readGitErrorOutput(error: unknown): string {
    if (!(error instanceof GithubGitCommandError)) {
      return "";
    }
    return `${error.stdout}\n${error.stderr}`.toLowerCase();
  }
}
