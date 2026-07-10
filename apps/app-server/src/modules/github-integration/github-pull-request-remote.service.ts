import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest, notFound } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import { ListGithubPullRequestFilesQuery } from "./dto";
import {
  GithubAppClient,
  type GithubPullRequestFileApiItem,
  type GithubRepositoryFileContentApiDetails
} from "./github-app.client";
import {
  GithubIntegrationConfigService,
  type GithubAppRuntimeConfig
} from "./github-integration-config.service";
import type {
  GithubPaginatedPayload,
  GithubPullRequestConflictStatus,
  GithubPullRequestConflictStatusPayload,
  GithubPullRequestConflictInputsPayload,
  GithubPullRequestFilePayload
} from "./types";

interface GithubPullRequestRemoteContextRow extends QueryResultRow {
  id: string;
  repository_id: string;
  pr_number: string | number;
  changed_files_count: string | number;
  html_url: string;
  owner_login: string;
  name: string;
  full_name: string;
  github_installation_id: string | number | null;
}

interface PaginationInput {
  page?: unknown;
  limit?: unknown;
}

interface NormalizedPagination {
  page: number;
  limit: number;
  offset: number;
}

const MAX_PAGE_LIMIT = 100;
const LARGE_DIFF_LINE_THRESHOLD = 1000;
const LARGE_DIFF_PATCH_BYTES = 200 * 1024;
const BINARY_FILE_EXTENSIONS = new Set([
  ".7z",
  ".avi",
  ".bmp",
  ".class",
  ".dll",
  ".dmg",
  ".doc",
  ".docx",
  ".eot",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".jar",
  ".jpeg",
  ".jpg",
  ".mov",
  ".mp3",
  ".mp4",
  ".ogg",
  ".otf",
  ".pdf",
  ".png",
  ".ppt",
  ".pptx",
  ".psd",
  ".rar",
  ".so",
  ".tar",
  ".ttf",
  ".wav",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
  ".xls",
  ".xlsx",
  ".zip"
]);

@Injectable()
export class GithubPullRequestRemoteService {
  constructor(
    private readonly database: DatabaseService,
    private readonly githubAppClient: GithubAppClient,
    private readonly configService: GithubIntegrationConfigService,
    private readonly workspaceService: WorkspaceService
  ) {}

  async listGithubPullRequestFiles(
    currentUserId: string,
    workspaceId: string,
    pullRequestId: string,
    query: ListGithubPullRequestFilesQuery
  ): Promise<GithubPaginatedPayload<GithubPullRequestFilePayload>> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const context = await this.findGithubPullRequestRemoteContext(
      workspaceId,
      pullRequestId
    );
    const pagination = this.normalizePagination(query, 20);
    const config = this.configService.getGithubAppConfig();
    const installationId = this.readGithubInstallationId(context);
    const files = await this.githubAppClient.listPullRequestFiles({
      installationId,
      appId: config.appId,
      privateKey: config.privateKey,
      owner: context.owner_login,
      repo: context.name,
      pullNumber: this.toInteger(
        context.pr_number,
        "Invalid GitHub pull request number"
      ),
      page: pagination.page,
      perPage: pagination.limit,
      now: config.now
    });

    return {
      data: files.map((file) => this.mapGithubPullRequestFile(file, context)),
      meta: {
        page: pagination.page,
        limit: pagination.limit,
        total: this.toInteger(
          context.changed_files_count,
          "Invalid GitHub pull request file count"
        )
      }
    };
  }

  async getGithubPullRequestConflictStatus(
    currentUserId: string,
    workspaceId: string,
    pullRequestId: string
  ): Promise<GithubPullRequestConflictStatusPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const context = await this.findGithubPullRequestRemoteContext(
      workspaceId,
      pullRequestId
    );
    const config = this.configService.getGithubAppConfig();
    let conflictStatus: GithubPullRequestConflictStatus;

    try {
      const pullRequest = await this.githubAppClient.getPullRequest({
        installationId: this.readGithubInstallationId(context),
        appId: config.appId,
        privateKey: config.privateKey,
        owner: context.owner_login,
        repo: context.name,
        pullNumber: this.toInteger(
          context.pr_number,
          "Invalid GitHub pull request number"
        ),
        now: config.now
      });
      conflictStatus = this.mapMergeableToConflictStatus(pullRequest.mergeable);
    } catch {
      conflictStatus = "unknown";
    }

    return {
      conflictStatus,
      conflictCheckedAt: this.getCurrentIsoString(config),
      message: this.getConflictStatusMessage(conflictStatus)
    };
  }

  async getGithubPullRequestConflictInputs(
    currentUserId: string,
    workspaceId: string,
    pullRequestId: string,
    input: {
      baseSha: string;
      headSha: string;
      filePaths: string[];
    }
  ): Promise<GithubPullRequestConflictInputsPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    if (!input.baseSha.trim() || !input.headSha.trim()) {
      throw badRequest("GitHub pull request base and head SHA are required");
    }

    const context = await this.findGithubPullRequestRemoteContext(
      workspaceId,
      pullRequestId
    );
    const config = this.configService.getGithubAppConfig();
    const installationId = this.readGithubInstallationId(context);
    const installationAccessToken = (
      await this.githubAppClient.createInstallationAccessToken({
        installationId,
        appId: config.appId,
        privateKey: config.privateKey,
        now: config.now
      })
    ).token;
    const mergeBase = await this.githubAppClient.getRepositoryMergeBase({
      installationId,
      installationAccessToken,
      appId: config.appId,
      privateKey: config.privateKey,
      owner: context.owner_login,
      repo: context.name,
      baseRef: input.baseSha,
      headRef: input.headSha,
      now: config.now
    });
    const files: GithubPullRequestConflictInputsPayload["files"] = [];

    for (const filePath of input.filePaths) {
      const [mergeBaseFile, baseFile, headFile] = await Promise.all([
        this.getRepositoryFileContent(context, config, {
          installationId,
          installationAccessToken,
          filePath,
          ref: mergeBase.mergeBaseSha
        }),
        this.getRepositoryFileContent(context, config, {
          installationId,
          installationAccessToken,
          filePath,
          ref: input.baseSha
        }),
        this.getRepositoryFileContent(context, config, {
          installationId,
          installationAccessToken,
          filePath,
          ref: input.headSha
        })
      ]);

      files.push({
        filePath,
        mergeBaseContent: mergeBaseFile?.content ?? null,
        baseContent: baseFile?.content ?? null,
        headContent: headFile?.content ?? null,
        headBlobSha: headFile?.sha ?? null,
        unsupportedReason: this.getMissingConflictContentReason({
          mergeBaseFile,
          baseFile,
          headFile
        })
      });
    }

    return {
      mergeBaseSha: mergeBase.mergeBaseSha,
      files
    };
  }

  private mapGithubPullRequestFile(
    file: GithubPullRequestFileApiItem,
    context: GithubPullRequestRemoteContextRow
  ): GithubPullRequestFilePayload {
    const additions = this.toInteger(
      file.additions,
      "Invalid GitHub pull request file additions"
    );
    const deletions = this.toInteger(
      file.deletions,
      "Invalid GitHub pull request file deletions"
    );
    const changes = this.toInteger(
      file.changes,
      "Invalid GitHub pull request file changes"
    );
    const patch = typeof file.patch === "string" ? file.patch : null;
    const isBinary = this.isBinaryFilePath(file.filename);
    const isLargeDiff =
      !isBinary && this.isLargeDiff({ additions, deletions, patch });

    return {
      filePath: file.filename,
      previousFilePath: file.previous_filename ?? null,
      fileName: this.getFileName(file.filename),
      fileStatus: file.status,
      additions,
      deletions,
      changes,
      isBinary,
      isLargeDiff,
      blobUrl: file.blob_url ?? null,
      rawUrl: file.raw_url ?? null,
      contentsUrl: file.contents_url ?? null,
      githubFileUrl: this.buildGithubFileUrl(context.html_url, file.sha ?? null),
      patch: isBinary || isLargeDiff ? null : patch
    };
  }

  private getRepositoryFileContent(
    context: GithubPullRequestRemoteContextRow,
    config: GithubAppRuntimeConfig,
    input: {
      installationId: number;
      installationAccessToken: string;
      filePath: string;
      ref: string;
    }
  ): Promise<GithubRepositoryFileContentApiDetails | null> {
    return this.githubAppClient.getRepositoryFileContent({
      installationId: input.installationId,
      installationAccessToken: input.installationAccessToken,
      appId: config.appId,
      privateKey: config.privateKey,
      owner: context.owner_login,
      repo: context.name,
      path: input.filePath,
      ref: input.ref,
      now: config.now
    });
  }

  private getMissingConflictContentReason(input: {
    mergeBaseFile: GithubRepositoryFileContentApiDetails | null;
    baseFile: GithubRepositoryFileContentApiDetails | null;
    headFile: GithubRepositoryFileContentApiDetails | null;
  }): string | null {
    if (!input.mergeBaseFile) {
      return "merge base content is not available";
    }

    if (!input.baseFile) {
      return "base branch content is not available";
    }

    if (!input.headFile) {
      return "head branch content is not available";
    }

    return null;
  }

  private async findGithubPullRequestRemoteContext(
    workspaceId: string,
    pullRequestId: string
  ): Promise<GithubPullRequestRemoteContextRow> {
    const row = await this.database.queryOne<GithubPullRequestRemoteContextRow>(
      `
        SELECT
          pr.id,
          pr.repository_id,
          pr.pr_number,
          pr.changed_files_count,
          pr.html_url,
          gr.owner_login,
          gr.name,
          gr.full_name,
          gi.github_installation_id
        FROM github_pull_requests pr
        JOIN github_repositories gr
          ON gr.id = pr.repository_id
         AND gr.workspace_id = pr.workspace_id
        LEFT JOIN github_installations gi
          ON gi.id = gr.installation_id
         AND gi.workspace_id = pr.workspace_id
        WHERE pr.workspace_id = $1
          AND pr.id = $2
      `,
      [workspaceId, pullRequestId]
    );

    if (!row) {
      throw notFound("GitHub pull request not found");
    }

    return row;
  }

  private readGithubInstallationId(
    row: GithubPullRequestRemoteContextRow
  ): number {
    if (row.github_installation_id === null) {
      throw badRequest("GitHub App installation is not connected");
    }

    return this.toNumber(row.github_installation_id);
  }

  private isLargeDiff(input: {
    additions: number;
    deletions: number;
    patch: string | null;
  }): boolean {
    if (input.additions + input.deletions >= LARGE_DIFF_LINE_THRESHOLD) {
      return true;
    }

    if (input.patch === null) {
      return true;
    }

    return Buffer.byteLength(input.patch, "utf8") >= LARGE_DIFF_PATCH_BYTES;
  }

  private isBinaryFilePath(filePath: string): boolean {
    const lowerPath = filePath.toLowerCase();
    const lastDotIndex = lowerPath.lastIndexOf(".");
    if (lastDotIndex === -1) {
      return false;
    }

    return BINARY_FILE_EXTENSIONS.has(lowerPath.slice(lastDotIndex));
  }

  private getFileName(filePath: string): string {
    const normalized = filePath.replace(/\\/g, "/");
    return normalized.split("/").pop() ?? normalized;
  }

  private buildGithubFileUrl(
    pullRequestUrl: string,
    fileSha: string | null
  ): string {
    const filesUrl = `${pullRequestUrl.replace(/\/+$/, "")}/files`;
    return fileSha ? `${filesUrl}#diff-${encodeURIComponent(fileSha)}` : filesUrl;
  }

  private mapMergeableToConflictStatus(
    mergeable: boolean | null
  ): GithubPullRequestConflictStatus {
    if (mergeable === true) {
      return "clean";
    }

    if (mergeable === false) {
      return "conflicted";
    }

    return "checking";
  }

  private getConflictStatusMessage(
    status: GithubPullRequestConflictStatus
  ): string {
    switch (status) {
      case "clean":
        return "Conflict가 없는 상태입니다.";
      case "conflicted":
        return "Conflict가 있는 상태입니다.";
      case "checking":
        return "Conflict 상태를 확인 중입니다.";
      case "unknown":
        return "Conflict 상태를 확인할 수 없습니다.";
    }
  }

  private getCurrentIsoString(config: Pick<GithubAppRuntimeConfig, "now">): string {
    return (config.now ? config.now() : new Date()).toISOString();
  }

  private normalizePagination(
    input: PaginationInput,
    defaultLimit: number
  ): NormalizedPagination {
    const page = this.readPositiveInteger(input.page, "page", 1);
    const limit = this.readPositiveInteger(input.limit, "limit", defaultLimit);

    if (limit > MAX_PAGE_LIMIT) {
      throw badRequest(`limit must be ${MAX_PAGE_LIMIT} or less`);
    }

    return {
      page,
      limit,
      offset: (page - 1) * limit
    };
  }

  private readPositiveInteger(
    value: unknown,
    field: string,
    defaultValue: number
  ): number {
    if (value === undefined || value === null || value === "") {
      return defaultValue;
    }

    if (Array.isArray(value)) {
      throw badRequest(`${field} must be a positive integer`);
    }

    const raw = typeof value === "number" ? String(value) : value;
    if (typeof raw !== "string" || !/^\d+$/.test(raw.trim())) {
      throw badRequest(`${field} must be a positive integer`);
    }

    const parsed = Number(raw.trim());
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw badRequest(`${field} must be a positive integer`);
    }

    return parsed;
  }

  private toInteger(value: string | number, message: string): number {
    const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
    if (!Number.isSafeInteger(parsed)) {
      throw badRequest(message);
    }

    return parsed;
  }

  private toNumber(value: string | number): number {
    const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
      throw badRequest("Invalid GitHub installation id");
    }

    return parsed;
  }
}
