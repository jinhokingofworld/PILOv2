import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest, notFound } from "../../common/api-error";
import {
  DatabaseService,
  type DatabaseTransaction
} from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import {
  parseUnifiedDiffPatch,
  type PrReviewDiffRowPayload
} from "./pr-review-diff-parser";
import {
  PrReviewAnalysisService,
  type PrReviewAnalysisResult,
  type ReviewFileMetadata
} from "./pr-review-analysis.service";
import { PrReviewGithubDependencyService } from "./pr-review-github-dependency.service";
import type {
  PrReviewConflictStatus,
  PrReviewFileReviewStatus,
  PrReviewFileStatus,
  PrReviewGithubChangedFile,
  PrReviewGithubPullRequestDetail,
  PrReviewModuleInfo,
  PrReviewSessionStatus
} from "./types";

interface PullRequestRow extends QueryResultRow {
  id: string;
}

interface PrReviewSessionRow extends QueryResultRow {
  id: string;
  pull_request_id: string;
  created_by_user_id: string | null;
  head_sha: string;
  status: PrReviewSessionStatus;
  pr_purpose: string | null;
  change_summary: unknown;
  recommended_review_order: string | null;
  caution_points: unknown;
  reviewed_count: number | string;
  total_file_count: number | string;
  conflict_status: PrReviewConflictStatus;
  conflict_checked_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface PrReviewSummaryRow extends PrReviewSessionRow {
  pr_number: number | string;
  title: string;
  author_login: string | null;
  author_avatar_url: string | null;
  github_created_at: Date | string | null;
  github_updated_at: Date | string | null;
  head_branch: string | null;
  base_branch: string | null;
  changed_files_count: number | string;
  additions: number | string;
  deletions: number | string;
  commits_count: number | string;
  html_url: string;
}

interface ReviewFlowRow extends QueryResultRow {
  id: string;
}

interface ReviewFlowListRow extends QueryResultRow {
  id: string;
  session_id: string;
  title: string;
  description: string | null;
  sort_order: number | string;
  file_count: number | string;
}

interface ReviewFlowFileRow extends QueryResultRow {
  id: string;
  session_id: string;
  flow_id: string;
  review_file_id: string;
  workflow_order: number | string;
  file_path: string;
  file_name: string;
  file_status: PrReviewFileStatus;
  file_role: string | null;
  current_status: PrReviewFileReviewStatus;
}

interface ReviewFileRow extends QueryResultRow {
  id: string;
}

interface ReviewFileResultRow extends QueryResultRow {
  id: string;
  file_path: string;
  file_name: string;
  current_status: PrReviewFileReviewStatus;
  comment: string | null;
  reviewed_by_user_id: string | null;
  reviewed_at: Date | string | null;
  workflow_order: number | string | null;
}

interface ReviewFileDetailRow extends QueryResultRow {
  id: string;
  session_id: string;
  pull_request_id: string;
  file_path: string;
  previous_file_path: string | null;
  file_name: string;
  file_status: PrReviewFileStatus;
  additions: number | string;
  deletions: number | string;
  is_binary: boolean;
  is_large_diff: boolean;
  github_file_url: string | null;
  file_role: string | null;
  change_reason: string | null;
  change_summary: string | null;
  review_points: unknown;
  current_status: PrReviewFileReviewStatus;
  comment: string | null;
  reviewed_by_user_id: string | null;
  reviewed_at: Date | string | null;
  latest_decision_id: string | null;
  latest_decision_status: PrReviewFileReviewStatus | null;
  latest_decision_comment: string | null;
  latest_decision_reviewed_by_user_id: string | null;
  latest_decision_reviewed_at: Date | string | null;
}

type PrReviewDecisionStatus = Exclude<PrReviewFileReviewStatus, "not_reviewed">;

interface ReviewFileDecisionTargetRow extends QueryResultRow {
  id: string;
  session_id: string;
}

interface ReviewFileDecisionRow extends QueryResultRow {
  id: string;
  review_file_id: string;
  status: PrReviewDecisionStatus;
  comment: string | null;
  reviewed_by_user_id: string;
  reviewed_at: Date | string;
}

interface ReviewFileFlowMembershipRow extends QueryResultRow {
  review_flow_file_id: string;
  flow_id: string;
  flow_title: string;
  workflow_order: number | string;
}

interface PrReviewSessionUpdateDraft {
  status?: unknown;
}

interface PrReviewFileDecisionDraft {
  status?: unknown;
  comment?: unknown;
}

interface ReviewProgressRow extends QueryResultRow {
  reviewed_count: number | string;
  total_file_count: number | string;
}

export interface PrReviewSessionPayload {
  id: string;
  pullRequestId: string;
  headSha: string;
  status: PrReviewSessionStatus;
  prPurpose: string | null;
  changeSummary: string[];
  recommendedReviewOrder: string | null;
  cautionPoints: string[];
  reviewedCount: number;
  totalFileCount: number;
  conflictStatus: PrReviewConflictStatus;
  conflictCheckedAt: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PrReviewSummaryPayload {
  reviewSessionId: string;
  pullRequestId: string;
  githubNumber: number;
  title: string;
  authorName: string | null;
  authorAvatarUrl: string | null;
  githubCreatedAt: string | null;
  githubUpdatedAt: string | null;
  headBranch: string | null;
  baseBranch: string | null;
  changedFilesCount: number;
  additions: number;
  deletions: number;
  commitsCount: number;
  githubUrl: string;
  headSha: string;
  status: PrReviewSessionStatus;
  prPurpose: string | null;
  changeSummary: string[];
  recommendedReviewOrder: string | null;
  cautionPoints: string[];
  reviewedCount: number;
  totalFileCount: number;
  conflictStatus: PrReviewConflictStatus;
  conflictCheckedAt: string | null;
  readyToSubmit: boolean;
}

export interface PrReviewStatusCountsPayload {
  approved: number;
  discussionNeeded: number;
  unknown: number;
  notReviewed: number;
  total: number;
}

export interface PrReviewResultFilePayload {
  reviewFileId: string;
  fileName: string;
  filePath: string;
  status: PrReviewFileReviewStatus;
  comment: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
}

export interface PrReviewResultPayload {
  reviewSessionId: string;
  status: PrReviewSessionStatus;
  reviewResultSummary: string;
  counts: PrReviewStatusCountsPayload;
  fileReviewResults: PrReviewResultFilePayload[];
  readyToSubmit: boolean;
}

export interface PrReviewFlowPayload {
  id: string;
  reviewSessionId: string;
  title: string;
  description: string | null;
  sortOrder: number;
  fileCount: number;
}

export interface PrReviewFlowListPayload {
  reviewSessionId: string;
  flows: PrReviewFlowPayload[];
}

export interface PrReviewFileNodeDataPayload {
  reviewFileId: string;
  reviewSessionId: string;
  reviewFlowFileId: string;
  flowId: string;
  workflowOrder: number;
  fileName: string;
  filePath: string;
  roleSummary: string | null;
  reviewStatus: PrReviewFileReviewStatus;
}

export interface PrReviewFlowFilePayload {
  id: string;
  reviewSessionId: string;
  flowId: string;
  reviewFileId: string;
  workflowOrder: number;
  filePath: string;
  fileName: string;
  fileStatus: PrReviewFileStatus;
  fileRole: string | null;
  currentStatus: PrReviewFileReviewStatus;
  fileNodeData: PrReviewFileNodeDataPayload;
}

export interface PrReviewFlowFilesPayload {
  reviewSessionId: string;
  flowId: string;
  files: PrReviewFlowFilePayload[];
}

export interface PrReviewCanvasFlowPayload extends PrReviewFlowPayload {
  files: PrReviewFlowFilePayload[];
}

export interface PrReviewCanvasEdgePayload {
  fromReviewFileId: string;
  toReviewFileId: string;
  flowId: string;
  reason: string;
}

export interface PrReviewCanvasPayload {
  reviewSessionId: string;
  headBranch: string | null;
  baseBranch: string | null;
  reviewedCount: number;
  totalFileCount: number;
  conflictStatus: PrReviewConflictStatus;
  flows: PrReviewCanvasFlowPayload[];
  edges: PrReviewCanvasEdgePayload[];
}

export interface PrReviewFileFlowMembershipPayload {
  reviewFlowFileId: string;
  flowId: string;
  flowTitle: string;
  workflowOrder: number;
}

export interface PrReviewLatestDecisionPayload {
  id: string;
  status: PrReviewFileReviewStatus;
  comment: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
}

export interface PrReviewFileDecisionPayload {
  id: string;
  reviewFileId: string;
  status: PrReviewDecisionStatus;
  comment: string | null;
  reviewedByUserId: string;
  reviewedAt: string;
}

export interface PrReviewFileDecisionListPayload {
  reviewFileId: string;
  decisions: PrReviewFileDecisionPayload[];
}

export interface PrReviewFilePayload {
  id: string;
  sessionId: string;
  filePath: string;
  previousFilePath: string | null;
  fileName: string;
  fileStatus: PrReviewFileStatus;
  additions: number;
  deletions: number;
  isBinary: boolean;
  isLargeDiff: boolean;
  githubFileUrl: string | null;
  fileRole: string | null;
  changeReason: string | null;
  changeSummary: string | null;
  reviewPoints: string[];
  currentStatus: PrReviewFileReviewStatus;
  comment: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  flowMemberships: PrReviewFileFlowMembershipPayload[];
  latestDecision: PrReviewLatestDecisionPayload | null;
}

export type PrReviewDiffMode = "side_by_side" | "binary" | "large";

export interface PrReviewFileDiffPayload {
  reviewFileId: string;
  filePath: string;
  mode: PrReviewDiffMode;
  isBinary: boolean;
  isLargeDiff: boolean;
  githubFileUrl: string | null;
  message?: string;
  rows: PrReviewDiffRowPayload[];
}

export interface DeletePrReviewSessionPayload {
  deleted: true;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SESSION_STATUSES: readonly PrReviewSessionStatus[] = [
  "analyzing",
  "reviewing",
  "ready_to_submit",
  "submitted",
  "failed",
  "archived"
];

const REVIEW_DECISION_STATUSES: readonly PrReviewDecisionStatus[] = [
  "approved",
  "discussion_needed",
  "unknown"
];

const LARGE_DIFF_LINE_THRESHOLD = 1000;
const LARGE_DIFF_PATCH_BYTES = 200 * 1024;

@Injectable()
export class PrReviewService {
  private readonly inFlightSessionCreations = new Set<string>();

  constructor(
    private readonly database: DatabaseService,
    private readonly workspaceService: WorkspaceService,
    private readonly githubDependency: PrReviewGithubDependencyService,
    private readonly analysisService: PrReviewAnalysisService
  ) {}

  getModuleInfo(): PrReviewModuleInfo {
    return {
      domain: "pr-review",
      apiContract: "docs/api/pr-review-api.md"
    };
  }

  async createReviewSession(
    currentUserId: string,
    workspaceId: string,
    pullRequestId: string
  ): Promise<PrReviewSessionPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const pullRequest = await this.findSyncedPullRequest(workspaceId, pullRequestId);
    if (!pullRequest) {
      throw notFound("Pull request not found in workspace");
    }

    const inFlightKey = `${currentUserId}:${workspaceId}:${pullRequestId}`;
    if (this.inFlightSessionCreations.has(inFlightKey)) {
      throw badRequest("Review session creation is already in progress");
    }

    this.inFlightSessionCreations.add(inFlightKey);

    try {
      const [detail, files, conflict] = await Promise.all([
        this.githubDependency.getPullRequestDetail(
          currentUserId,
          workspaceId,
          pullRequestId
        ),
        this.githubDependency.getPullRequestChangedFiles(
          currentUserId,
          workspaceId,
          pullRequestId
        ),
        this.githubDependency.getPullRequestConflictStatus(
          currentUserId,
          workspaceId,
          pullRequestId
        )
      ]);
      const analysis = await this.analysisService.analyzePullRequest(detail, files);

      return this.database.transaction(async (transaction) => {
        const session = await this.insertReviewSession(transaction, {
          currentUserId,
          pullRequestId,
          detail,
          files,
          conflictStatus: conflict.conflictStatus,
          conflictCheckedAt: conflict.checkedAt,
          analysis
        });

        if (files.length > 0) {
          await this.insertReviewFlow(transaction, session.id, files, analysis);
        }

        return this.mapSession(session);
      });
    } finally {
      this.inFlightSessionCreations.delete(inFlightKey);
    }
  }

  async getReviewSession(
    currentUserId: string,
    workspaceId: string,
    reviewSessionId: string
  ): Promise<PrReviewSessionPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const session = await this.findReviewSession(workspaceId, reviewSessionId);
    if (!session) {
      throw notFound("Review session not found");
    }

    return this.mapSession(session);
  }

  async getReviewSessionSummary(
    currentUserId: string,
    workspaceId: string,
    reviewSessionId: string
  ): Promise<PrReviewSummaryPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const summary = await this.findReviewSessionSummary(workspaceId, reviewSessionId);
    if (!summary) {
      throw notFound("Review session not found");
    }

    return this.mapSummary(summary);
  }

  async getReviewSessionResult(
    currentUserId: string,
    workspaceId: string,
    reviewSessionId: string
  ): Promise<PrReviewResultPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const session = await this.findReviewSession(workspaceId, reviewSessionId);
    if (!session) {
      throw notFound("Review session not found");
    }

    const files = await this.listReviewFilesForSession(workspaceId, reviewSessionId);
    const counts = this.countReviewStatuses(files);

    return {
      reviewSessionId: session.id,
      status: session.status,
      reviewResultSummary: this.buildReviewResultSummary(counts),
      counts,
      fileReviewResults: files.map((file) => ({
        reviewFileId: file.id,
        fileName: file.file_name,
        filePath: file.file_path,
        status: file.current_status,
        comment: file.comment,
        reviewedByUserId: file.reviewed_by_user_id,
        reviewedAt: this.toNullableIsoString(file.reviewed_at)
      })),
      readyToSubmit: this.isReadyToSubmit(counts)
    };
  }

  async getReviewSessionCanvas(
    currentUserId: string,
    workspaceId: string,
    reviewSessionId: string
  ): Promise<PrReviewCanvasPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const summary = await this.findReviewSessionSummary(workspaceId, reviewSessionId);
    if (!summary) {
      throw notFound("Review session not found");
    }

    const [flows, flowFiles] = await Promise.all([
      this.listReviewFlowsForSession(workspaceId, reviewSessionId),
      this.listReviewFlowFilesForSession(workspaceId, reviewSessionId)
    ]);
    const filesByFlow = new Map<string, PrReviewFlowFilePayload[]>();

    for (const flowFile of flowFiles) {
      const payload = this.mapFlowFile(flowFile);
      const files = filesByFlow.get(payload.flowId) ?? [];
      files.push(payload);
      filesByFlow.set(payload.flowId, files);
    }

    const canvasFlows: PrReviewCanvasFlowPayload[] = flows.map((flow) => ({
      ...this.mapFlow(flow),
      files: filesByFlow.get(flow.id) ?? []
    }));

    return {
      reviewSessionId: summary.id,
      headBranch: summary.head_branch,
      baseBranch: summary.base_branch,
      reviewedCount: Number(summary.reviewed_count),
      totalFileCount: Number(summary.total_file_count),
      conflictStatus: summary.conflict_status,
      flows: canvasFlows,
      edges: this.buildCanvasEdges(canvasFlows)
    };
  }

  async listReviewFlows(
    currentUserId: string,
    workspaceId: string,
    reviewSessionId: string
  ): Promise<PrReviewFlowListPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const session = await this.findReviewSession(workspaceId, reviewSessionId);
    if (!session) {
      throw notFound("Review session not found");
    }

    const flows = await this.listReviewFlowsForSession(workspaceId, reviewSessionId);
    return {
      reviewSessionId: session.id,
      flows: flows.map((flow) => this.mapFlow(flow))
    };
  }

  async listReviewFlowFiles(
    currentUserId: string,
    workspaceId: string,
    flowId: string
  ): Promise<PrReviewFlowFilesPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const flow = await this.findReviewFlow(workspaceId, flowId);
    if (!flow) {
      throw notFound("Review flow not found");
    }

    const files = await this.listReviewFlowFilesForFlow(workspaceId, flowId);
    return {
      reviewSessionId: flow.session_id,
      flowId: flow.id,
      files: files.map((file) => this.mapFlowFile(file))
    };
  }

  async getReviewFile(
    currentUserId: string,
    workspaceId: string,
    reviewFileId: string
  ): Promise<PrReviewFilePayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const file = await this.findReviewFile(workspaceId, reviewFileId);
    if (!file) {
      throw notFound("Review file not found");
    }

    const flowMemberships = await this.listReviewFileFlowMemberships(
      workspaceId,
      reviewFileId
    );

    return this.mapReviewFile(file, flowMemberships);
  }

  async updateReviewFileDecision(
    currentUserId: string,
    workspaceId: string,
    reviewFileId: string,
    body: unknown
  ): Promise<PrReviewFilePayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const reviewFileUuid = this.requireUuid(reviewFileId, "reviewFileId");
    const input = this.normalizeReviewDecision(body);
    const updatedFile = await this.database.transaction(async (transaction) => {
      const file = await this.updateReviewFileDecisionState(transaction, {
        workspaceId,
        reviewFileId: reviewFileUuid,
        currentUserId,
        status: input.status,
        comment: input.comment
      });

      if (!file) {
        return null;
      }

      await this.insertReviewFileDecision(transaction, {
        reviewFileId: file.id,
        currentUserId,
        status: input.status,
        comment: input.comment
      });
      await this.syncReviewSessionReviewProgress(transaction, file.session_id);

      return file;
    });

    if (!updatedFile) {
      throw notFound("Review file not found");
    }

    const [file, flowMemberships] = await Promise.all([
      this.findReviewFile(workspaceId, updatedFile.id),
      this.listReviewFileFlowMemberships(workspaceId, updatedFile.id)
    ]);

    if (!file) {
      throw notFound("Review file not found");
    }

    return this.mapReviewFile(file, flowMemberships);
  }

  async listReviewFileDecisions(
    currentUserId: string,
    workspaceId: string,
    reviewFileId: string
  ): Promise<PrReviewFileDecisionListPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const reviewFileUuid = this.requireUuid(reviewFileId, "reviewFileId");
    const file = await this.findReviewFile(workspaceId, reviewFileUuid);
    if (!file) {
      throw notFound("Review file not found");
    }

    const decisions = await this.listReviewFileDecisionRows(
      workspaceId,
      reviewFileUuid
    );

    return {
      reviewFileId: file.id,
      decisions: decisions.map((decision) => this.mapDecision(decision))
    };
  }

  async getReviewFileDiff(
    currentUserId: string,
    workspaceId: string,
    reviewFileId: string
  ): Promise<PrReviewFileDiffPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const file = await this.findReviewFile(workspaceId, reviewFileId);
    if (!file) {
      throw notFound("Review file not found");
    }

    if (file.is_binary) {
      return this.buildDiffFallback(file, "binary");
    }

    const changedFiles = await this.githubDependency.getPullRequestChangedFiles(
      currentUserId,
      workspaceId,
      file.pull_request_id
    );
    const changedFile = this.findChangedFileForReviewFile(file, changedFiles);
    const githubFileUrl = changedFile?.githubFileUrl ?? file.github_file_url;
    if (changedFile?.isBinary === true) {
      return this.buildDiffFallback(file, "binary", githubFileUrl);
    }

    const patch = changedFile?.patch ?? null;
    const patchSizeBytes = changedFile?.patchSizeBytes ?? 0;
    const isLargeDiff =
      file.is_large_diff ||
      changedFile?.isLargeDiff === true ||
      this.isLargeDiff({
        additions: Number(file.additions),
        deletions: Number(file.deletions),
        patch,
        patchSizeBytes
      });

    if (isLargeDiff) {
      return this.buildDiffFallback(file, "large", githubFileUrl);
    }

    return {
      reviewFileId: file.id,
      filePath: file.file_path,
      mode: "side_by_side",
      isBinary: false,
      isLargeDiff: false,
      githubFileUrl,
      rows: parseUnifiedDiffPatch(patch ?? "")
    };
  }

  async updateReviewSession(
    currentUserId: string,
    workspaceId: string,
    reviewSessionId: string,
    body: unknown
  ): Promise<PrReviewSessionPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const input = this.normalizeSessionUpdate(body);
    const session = await this.database.queryOne<PrReviewSessionRow>(
      `
        UPDATE pr_review_sessions AS review_session
        SET status = $3
        FROM github_pull_requests AS pull_request
        WHERE review_session.pull_request_id = pull_request.id
          AND pull_request.workspace_id = $1
          AND review_session.id = $2
        RETURNING
          review_session.id,
          review_session.pull_request_id,
          review_session.created_by_user_id,
          review_session.head_sha,
          review_session.status,
          review_session.pr_purpose,
          review_session.change_summary,
          review_session.recommended_review_order,
          review_session.caution_points,
          review_session.reviewed_count,
          review_session.total_file_count,
          review_session.conflict_status,
          review_session.conflict_checked_at,
          review_session.created_at,
          review_session.updated_at
      `,
      [workspaceId, this.requireUuid(reviewSessionId, "reviewSessionId"), input.status]
    );

    if (!session) {
      throw notFound("Review session not found");
    }

    return this.mapSession(session);
  }

  async deleteReviewSession(
    currentUserId: string,
    workspaceId: string,
    reviewSessionId: string
  ): Promise<DeletePrReviewSessionPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const deleted = await this.database.queryOne<{ id: string }>(
      `
        DELETE FROM pr_review_sessions AS review_session
        USING github_pull_requests AS pull_request
        WHERE review_session.pull_request_id = pull_request.id
          AND pull_request.workspace_id = $1
          AND review_session.id = $2
        RETURNING review_session.id
      `,
      [workspaceId, this.requireUuid(reviewSessionId, "reviewSessionId")]
    );

    if (!deleted) {
      throw notFound("Review session not found");
    }

    return {
      deleted: true
    };
  }

  private async findSyncedPullRequest(
    workspaceId: string,
    pullRequestId: string
  ): Promise<PullRequestRow | null> {
    if (!UUID_PATTERN.test(pullRequestId)) {
      return null;
    }

    return this.database.queryOne<PullRequestRow>(
      `
        SELECT id
        FROM github_pull_requests
        WHERE workspace_id = $1
          AND id = $2
      `,
      [workspaceId, pullRequestId]
    );
  }

  private async findReviewSession(
    workspaceId: string,
    reviewSessionId: string
  ): Promise<PrReviewSessionRow | null> {
    if (!UUID_PATTERN.test(reviewSessionId)) {
      return null;
    }

    return this.database.queryOne<PrReviewSessionRow>(
      `
        SELECT
          review_session.id,
          review_session.pull_request_id,
          review_session.created_by_user_id,
          review_session.head_sha,
          review_session.status,
          review_session.pr_purpose,
          review_session.change_summary,
          review_session.recommended_review_order,
          review_session.caution_points,
          review_session.reviewed_count,
          review_session.total_file_count,
          review_session.conflict_status,
          review_session.conflict_checked_at,
          review_session.created_at,
          review_session.updated_at
        FROM pr_review_sessions AS review_session
        JOIN github_pull_requests AS pull_request
          ON pull_request.id = review_session.pull_request_id
        WHERE pull_request.workspace_id = $1
          AND review_session.id = $2
      `,
      [workspaceId, reviewSessionId]
    );
  }

  private async findReviewSessionSummary(
    workspaceId: string,
    reviewSessionId: string
  ): Promise<PrReviewSummaryRow | null> {
    if (!UUID_PATTERN.test(reviewSessionId)) {
      return null;
    }

    return this.database.queryOne<PrReviewSummaryRow>(
      `
        SELECT
          review_session.id,
          review_session.pull_request_id,
          review_session.created_by_user_id,
          review_session.head_sha,
          review_session.status,
          review_session.pr_purpose,
          review_session.change_summary,
          review_session.recommended_review_order,
          review_session.caution_points,
          review_session.reviewed_count,
          review_session.total_file_count,
          review_session.conflict_status,
          review_session.conflict_checked_at,
          review_session.created_at,
          review_session.updated_at,
          pull_request.pr_number,
          pull_request.title,
          pull_request.author_login,
          pull_request.author_avatar_url,
          pull_request.github_created_at,
          pull_request.github_updated_at,
          pull_request.head_branch,
          pull_request.base_branch,
          pull_request.changed_files_count,
          pull_request.additions,
          pull_request.deletions,
          pull_request.commits_count,
          pull_request.html_url
        FROM pr_review_sessions AS review_session
        JOIN github_pull_requests AS pull_request
          ON pull_request.id = review_session.pull_request_id
        WHERE pull_request.workspace_id = $1
          AND review_session.id = $2
      `,
      [workspaceId, reviewSessionId]
    );
  }

  private async listReviewFilesForSession(
    workspaceId: string,
    reviewSessionId: string
  ): Promise<ReviewFileResultRow[]> {
    return this.database.query<ReviewFileResultRow>(
      `
        SELECT
          review_file.id,
          review_file.file_path,
          review_file.file_name,
          review_file.current_status,
          review_file.comment,
          review_file.reviewed_by_user_id,
          review_file.reviewed_at,
          MIN(flow_file.workflow_order) AS workflow_order
        FROM review_files AS review_file
        JOIN pr_review_sessions AS review_session
          ON review_session.id = review_file.session_id
        JOIN github_pull_requests AS pull_request
          ON pull_request.id = review_session.pull_request_id
        LEFT JOIN review_flow_files AS flow_file
          ON flow_file.session_id = review_file.session_id
         AND flow_file.review_file_id = review_file.id
        WHERE pull_request.workspace_id = $1
          AND review_session.id = $2
        GROUP BY
          review_file.id,
          review_file.file_path,
          review_file.file_name,
          review_file.current_status,
          review_file.comment,
          review_file.reviewed_by_user_id,
          review_file.reviewed_at
        ORDER BY workflow_order ASC NULLS LAST, review_file.file_path ASC
      `,
      [workspaceId, this.requireUuid(reviewSessionId, "reviewSessionId")]
    );
  }

  private async listReviewFlowsForSession(
    workspaceId: string,
    reviewSessionId: string
  ): Promise<ReviewFlowListRow[]> {
    return this.database.query<ReviewFlowListRow>(
      `
        SELECT
          flow.id,
          flow.session_id,
          flow.title,
          flow.description,
          flow.sort_order,
          COUNT(flow_file.id) AS file_count
        FROM review_flows AS flow
        JOIN pr_review_sessions AS review_session
          ON review_session.id = flow.session_id
        JOIN github_pull_requests AS pull_request
          ON pull_request.id = review_session.pull_request_id
        LEFT JOIN review_flow_files AS flow_file
          ON flow_file.session_id = flow.session_id
         AND flow_file.flow_id = flow.id
        WHERE pull_request.workspace_id = $1
          AND review_session.id = $2
        GROUP BY
          flow.id,
          flow.session_id,
          flow.title,
          flow.description,
          flow.sort_order
        ORDER BY flow.sort_order ASC, flow.id ASC
      `,
      [workspaceId, this.requireUuid(reviewSessionId, "reviewSessionId")]
    );
  }

  private async findReviewFlow(
    workspaceId: string,
    flowId: string
  ): Promise<ReviewFlowListRow | null> {
    if (!UUID_PATTERN.test(flowId)) {
      return null;
    }

    return this.database.queryOne<ReviewFlowListRow>(
      `
        SELECT
          flow.id,
          flow.session_id,
          flow.title,
          flow.description,
          flow.sort_order,
          COUNT(flow_file.id) AS file_count
        FROM review_flows AS flow
        JOIN pr_review_sessions AS review_session
          ON review_session.id = flow.session_id
        JOIN github_pull_requests AS pull_request
          ON pull_request.id = review_session.pull_request_id
        LEFT JOIN review_flow_files AS flow_file
          ON flow_file.session_id = flow.session_id
         AND flow_file.flow_id = flow.id
        WHERE pull_request.workspace_id = $1
          AND flow.id = $2
        GROUP BY
          flow.id,
          flow.session_id,
          flow.title,
          flow.description,
          flow.sort_order
      `,
      [workspaceId, flowId]
    );
  }

  private async listReviewFlowFilesForSession(
    workspaceId: string,
    reviewSessionId: string
  ): Promise<ReviewFlowFileRow[]> {
    return this.database.query<ReviewFlowFileRow>(
      `
        SELECT
          flow_file.id,
          flow_file.session_id,
          flow_file.flow_id,
          flow_file.review_file_id,
          flow_file.workflow_order,
          review_file.file_path,
          review_file.file_name,
          review_file.file_status,
          review_file.file_role,
          review_file.current_status
        FROM review_flow_files AS flow_file
        JOIN review_flows AS flow
          ON flow.session_id = flow_file.session_id
         AND flow.id = flow_file.flow_id
        JOIN review_files AS review_file
          ON review_file.session_id = flow_file.session_id
         AND review_file.id = flow_file.review_file_id
        JOIN pr_review_sessions AS review_session
          ON review_session.id = flow_file.session_id
        JOIN github_pull_requests AS pull_request
          ON pull_request.id = review_session.pull_request_id
        WHERE pull_request.workspace_id = $1
          AND review_session.id = $2
        ORDER BY flow.sort_order ASC, flow_file.workflow_order ASC, review_file.file_path ASC
      `,
      [workspaceId, this.requireUuid(reviewSessionId, "reviewSessionId")]
    );
  }

  private async listReviewFlowFilesForFlow(
    workspaceId: string,
    flowId: string
  ): Promise<ReviewFlowFileRow[]> {
    return this.database.query<ReviewFlowFileRow>(
      `
        SELECT
          flow_file.id,
          flow_file.session_id,
          flow_file.flow_id,
          flow_file.review_file_id,
          flow_file.workflow_order,
          review_file.file_path,
          review_file.file_name,
          review_file.file_status,
          review_file.file_role,
          review_file.current_status
        FROM review_flow_files AS flow_file
        JOIN review_flows AS flow
          ON flow.session_id = flow_file.session_id
         AND flow.id = flow_file.flow_id
        JOIN review_files AS review_file
          ON review_file.session_id = flow_file.session_id
         AND review_file.id = flow_file.review_file_id
        JOIN pr_review_sessions AS review_session
          ON review_session.id = flow_file.session_id
        JOIN github_pull_requests AS pull_request
          ON pull_request.id = review_session.pull_request_id
        WHERE pull_request.workspace_id = $1
          AND flow.id = $2
        ORDER BY flow_file.workflow_order ASC, review_file.file_path ASC
      `,
      [workspaceId, this.requireUuid(flowId, "flowId")]
    );
  }

  private async findReviewFile(
    workspaceId: string,
    reviewFileId: string
  ): Promise<ReviewFileDetailRow | null> {
    if (!UUID_PATTERN.test(reviewFileId)) {
      return null;
    }

    return this.database.queryOne<ReviewFileDetailRow>(
      `
        SELECT
          review_file.id,
          review_file.session_id,
          review_session.pull_request_id,
          review_file.file_path,
          review_file.previous_file_path,
          review_file.file_name,
          review_file.file_status,
          review_file.additions,
          review_file.deletions,
          review_file.is_binary,
          review_file.is_large_diff,
          review_file.github_file_url,
          review_file.file_role,
          review_file.change_reason,
          review_file.change_summary,
          review_file.review_points,
          review_file.current_status,
          review_file.comment,
          review_file.reviewed_by_user_id,
          review_file.reviewed_at,
          latest_decision.id AS latest_decision_id,
          latest_decision.status AS latest_decision_status,
          latest_decision.comment AS latest_decision_comment,
          latest_decision.reviewed_by_user_id AS latest_decision_reviewed_by_user_id,
          latest_decision.reviewed_at AS latest_decision_reviewed_at
        FROM review_files AS review_file
        JOIN pr_review_sessions AS review_session
          ON review_session.id = review_file.session_id
        JOIN github_pull_requests AS pull_request
          ON pull_request.id = review_session.pull_request_id
        LEFT JOIN LATERAL (
          SELECT
            decision.id,
            decision.status,
            decision.comment,
            decision.reviewed_by_user_id,
            decision.reviewed_at
          FROM file_review_decisions AS decision
          WHERE decision.review_file_id = review_file.id
          ORDER BY decision.reviewed_at DESC, decision.id DESC
          LIMIT 1
        ) AS latest_decision ON true
        WHERE pull_request.workspace_id = $1
          AND review_file.id = $2
      `,
      [workspaceId, reviewFileId]
    );
  }

  private async listReviewFileFlowMemberships(
    workspaceId: string,
    reviewFileId: string
  ): Promise<ReviewFileFlowMembershipRow[]> {
    return this.database.query<ReviewFileFlowMembershipRow>(
      `
        SELECT
          flow_file.id AS review_flow_file_id,
          flow_file.flow_id,
          flow.title AS flow_title,
          flow_file.workflow_order
        FROM review_flow_files AS flow_file
        JOIN review_flows AS flow
          ON flow.session_id = flow_file.session_id
         AND flow.id = flow_file.flow_id
        JOIN review_files AS review_file
          ON review_file.session_id = flow_file.session_id
         AND review_file.id = flow_file.review_file_id
        JOIN pr_review_sessions AS review_session
          ON review_session.id = flow_file.session_id
        JOIN github_pull_requests AS pull_request
          ON pull_request.id = review_session.pull_request_id
        WHERE pull_request.workspace_id = $1
          AND review_file.id = $2
        ORDER BY flow.sort_order ASC, flow_file.workflow_order ASC
      `,
      [workspaceId, this.requireUuid(reviewFileId, "reviewFileId")]
    );
  }

  private async listReviewFileDecisionRows(
    workspaceId: string,
    reviewFileId: string
  ): Promise<ReviewFileDecisionRow[]> {
    return this.database.query<ReviewFileDecisionRow>(
      `
        SELECT
          decision.id,
          decision.review_file_id,
          decision.status,
          decision.comment,
          decision.reviewed_by_user_id,
          decision.reviewed_at
        FROM file_review_decisions AS decision
        JOIN review_files AS review_file
          ON review_file.id = decision.review_file_id
        JOIN pr_review_sessions AS review_session
          ON review_session.id = review_file.session_id
        JOIN github_pull_requests AS pull_request
          ON pull_request.id = review_session.pull_request_id
        WHERE pull_request.workspace_id = $1
          AND review_file.id = $2
        ORDER BY decision.reviewed_at DESC, decision.id DESC
      `,
      [workspaceId, this.requireUuid(reviewFileId, "reviewFileId")]
    );
  }

  private async updateReviewFileDecisionState(
    transaction: DatabaseTransaction,
    input: {
      workspaceId: string;
      reviewFileId: string;
      currentUserId: string;
      status: PrReviewDecisionStatus;
      comment: string | null;
    }
  ): Promise<ReviewFileDecisionTargetRow | null> {
    return transaction.queryOne<ReviewFileDecisionTargetRow>(
      `
        UPDATE review_files AS review_file
        SET current_status = $3,
            comment = $4,
            reviewed_by_user_id = $5,
            reviewed_at = now()
        FROM pr_review_sessions AS review_session
        JOIN github_pull_requests AS pull_request
          ON pull_request.id = review_session.pull_request_id
        WHERE review_file.session_id = review_session.id
          AND pull_request.workspace_id = $1
          AND review_file.id = $2
        RETURNING review_file.id, review_file.session_id
      `,
      [
        input.workspaceId,
        input.reviewFileId,
        input.status,
        input.comment,
        input.currentUserId
      ]
    );
  }

  private async insertReviewFileDecision(
    transaction: DatabaseTransaction,
    input: {
      reviewFileId: string;
      currentUserId: string;
      status: PrReviewDecisionStatus;
      comment: string | null;
    }
  ): Promise<void> {
    const decision = await transaction.queryOne<{ id: string }>(
      `
        INSERT INTO file_review_decisions (
          review_file_id,
          reviewed_by_user_id,
          status,
          comment
        )
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `,
      [input.reviewFileId, input.currentUserId, input.status, input.comment]
    );

    if (!decision) {
      throw badRequest("Review decision could not be saved");
    }
  }

  private async syncReviewSessionReviewProgress(
    transaction: DatabaseTransaction,
    reviewSessionId: string
  ): Promise<void> {
    const progress = await transaction.queryOne<ReviewProgressRow>(
      `
        SELECT
          COUNT(*) FILTER (WHERE current_status <> 'not_reviewed') AS reviewed_count,
          COUNT(*) AS total_file_count
        FROM review_files
        WHERE session_id = $1
      `,
      [reviewSessionId]
    );

    if (!progress) {
      throw badRequest("Review session progress could not be calculated");
    }

    const reviewedCount = Number(progress.reviewed_count);
    const totalFileCount = Number(progress.total_file_count);
    const updated = await transaction.queryOne<{ id: string }>(
      `
        UPDATE pr_review_sessions AS review_session
        SET reviewed_count = $2,
            total_file_count = $3,
            status = CASE
              WHEN review_session.status IN ('submitted', 'archived')
                THEN review_session.status
              WHEN $2 = $3
                THEN 'ready_to_submit'
              WHEN review_session.status = 'ready_to_submit'
                THEN 'reviewing'
              ELSE review_session.status
            END
        WHERE review_session.id = $1
        RETURNING review_session.id
      `,
      [reviewSessionId, reviewedCount, totalFileCount]
    );

    if (!updated) {
      throw badRequest("Review session progress could not be updated");
    }
  }

  private async insertReviewSession(
    transaction: DatabaseTransaction,
    input: {
      currentUserId: string;
      pullRequestId: string;
      detail: PrReviewGithubPullRequestDetail;
      files: PrReviewGithubChangedFile[];
      conflictStatus: PrReviewConflictStatus;
      conflictCheckedAt: string | null;
      analysis: PrReviewAnalysisResult;
    }
  ): Promise<PrReviewSessionRow> {
    const session = await transaction.queryOne<PrReviewSessionRow>(
      `
        INSERT INTO pr_review_sessions (
          pull_request_id,
          created_by_user_id,
          head_sha,
          status,
          pr_purpose,
          change_summary,
          recommended_review_order,
          caution_points,
          reviewed_count,
          total_file_count,
          conflict_status,
          conflict_checked_at
        )
        VALUES (
          $1,
          $2,
          $3,
          'reviewing',
          $4,
          $5::jsonb,
          $6,
          $7::jsonb,
          0,
          $8,
          $9,
          $10
        )
        RETURNING
          id,
          pull_request_id,
          created_by_user_id,
          head_sha,
          status,
          pr_purpose,
          change_summary,
          recommended_review_order,
          caution_points,
          reviewed_count,
          total_file_count,
          conflict_status,
          conflict_checked_at,
          created_at,
          updated_at
      `,
      [
        input.pullRequestId,
        input.currentUserId,
        input.detail.headSha,
        input.analysis.prPurpose,
        JSON.stringify(input.analysis.changeSummary),
        input.analysis.recommendedReviewOrder,
        JSON.stringify(input.analysis.cautionPoints),
        input.files.length,
        input.conflictStatus,
        input.conflictCheckedAt
      ]
    );

    if (!session) {
      throw badRequest("Review session could not be created");
    }

    return session;
  }

  private async insertReviewFlow(
    transaction: DatabaseTransaction,
    sessionId: string,
    files: PrReviewGithubChangedFile[],
    analysis: PrReviewAnalysisResult
  ): Promise<void> {
    const flow = await transaction.queryOne<ReviewFlowRow>(
      `
        INSERT INTO review_flows (
          session_id,
          title,
          description,
          sort_order
        )
        VALUES ($1, $2, $3, 1)
        RETURNING id
      `,
      [sessionId, analysis.flowTitle, analysis.flowDescription]
    );

    if (!flow) {
      throw badRequest("Review flow could not be created");
    }

    for (const [index, file] of files.entries()) {
      const metadata = analysis.files[index];
      const reviewFile = await this.insertReviewFile(
        transaction,
        sessionId,
        file,
        metadata
      );

      await transaction.queryOne<{ id: string }>(
        `
          INSERT INTO review_flow_files (
            session_id,
            flow_id,
            review_file_id,
            workflow_order
          )
          VALUES ($1, $2, $3, $4)
          RETURNING id
        `,
        [sessionId, flow.id, reviewFile.id, index + 1]
      );
    }
  }

  private async insertReviewFile(
    transaction: DatabaseTransaction,
    sessionId: string,
    file: PrReviewGithubChangedFile,
    metadata: ReviewFileMetadata
  ): Promise<ReviewFileRow> {
    const reviewFile = await transaction.queryOne<ReviewFileRow>(
      `
        INSERT INTO review_files (
          session_id,
          file_path,
          previous_file_path,
          file_name,
          file_status,
          additions,
          deletions,
          is_binary,
          is_large_diff,
          github_file_url,
          file_role,
          change_reason,
          change_summary,
          review_points
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14::jsonb
        )
        RETURNING id
      `,
      [
        sessionId,
        file.filePath,
        file.previousFilePath,
        file.fileName,
        file.fileStatus,
        file.additions,
        file.deletions,
        file.isBinary,
        file.isLargeDiff,
        file.githubFileUrl,
        metadata.fileRole,
        metadata.changeReason,
        metadata.changeSummary,
        JSON.stringify(metadata.reviewPoints)
      ]
    );

    if (!reviewFile) {
      throw badRequest("Review file could not be created");
    }

    return reviewFile;
  }

  private findChangedFileForReviewFile(
    file: ReviewFileDetailRow,
    changedFiles: PrReviewGithubChangedFile[]
  ): PrReviewGithubChangedFile | null {
    return (
      changedFiles.find((changedFile) => changedFile.filePath === file.file_path) ??
      changedFiles.find(
        (changedFile) =>
          file.previous_file_path !== null &&
          changedFile.previousFilePath === file.previous_file_path
      ) ??
      null
    );
  }

  private isLargeDiff(input: {
    additions: number;
    deletions: number;
    patch: string | null;
    patchSizeBytes: number;
  }): boolean {
    if (input.additions + input.deletions >= LARGE_DIFF_LINE_THRESHOLD) {
      return true;
    }

    if (input.patch === null) {
      return true;
    }

    return input.patchSizeBytes >= LARGE_DIFF_PATCH_BYTES;
  }

  private buildDiffFallback(
    file: ReviewFileDetailRow,
    mode: Exclude<PrReviewDiffMode, "side_by_side">,
    githubFileUrl = file.github_file_url
  ): PrReviewFileDiffPayload {
    return {
      reviewFileId: file.id,
      filePath: file.file_path,
      mode,
      isBinary: mode === "binary" || file.is_binary,
      isLargeDiff: mode === "large" || file.is_large_diff,
      githubFileUrl,
      message: this.getDiffFallbackMessage(mode),
      rows: []
    };
  }

  private getDiffFallbackMessage(
    mode: Exclude<PrReviewDiffMode, "side_by_side">
  ): string {
    switch (mode) {
      case "binary":
        return "Binary 파일은 PILO diff에서 미리보기하지 않습니다. GitHub에서 확인해주세요.";
      case "large":
        return "큰 diff 또는 patch가 누락된 파일은 PILO diff에서 미리보기하지 않습니다. GitHub에서 확인해주세요.";
    }
  }

  private normalizeSessionUpdate(body: unknown): { status: PrReviewSessionStatus } {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw badRequest("Request body must be an object");
    }

    const draft = body as PrReviewSessionUpdateDraft;
    if (typeof draft.status !== "string" || !this.isSessionStatus(draft.status)) {
      throw badRequest("status must be a valid review session status");
    }

    return {
      status: draft.status
    };
  }

  private normalizeReviewDecision(body: unknown): {
    status: PrReviewDecisionStatus;
    comment: string | null;
  } {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw badRequest("Request body must be an object");
    }

    const draft = body as PrReviewFileDecisionDraft;
    if (
      typeof draft.status !== "string" ||
      !this.isReviewDecisionStatus(draft.status)
    ) {
      throw badRequest("status must be approved, discussion_needed, or unknown");
    }

    if (draft.comment === undefined || draft.comment === null) {
      return {
        status: draft.status,
        comment: null
      };
    }

    if (typeof draft.comment !== "string") {
      throw badRequest("comment must be a string or null");
    }

    return {
      status: draft.status,
      comment: draft.comment
    };
  }

  private isSessionStatus(value: string): value is PrReviewSessionStatus {
    return SESSION_STATUSES.includes(value as PrReviewSessionStatus);
  }

  private isReviewDecisionStatus(value: string): value is PrReviewDecisionStatus {
    return REVIEW_DECISION_STATUSES.includes(value as PrReviewDecisionStatus);
  }

  private requireUuid(value: string, field: string): string {
    if (!UUID_PATTERN.test(value)) {
      throw badRequest(`${field} must be a valid UUID`);
    }

    return value;
  }

  private mapSession(session: PrReviewSessionRow): PrReviewSessionPayload {
    return {
      id: session.id,
      pullRequestId: session.pull_request_id,
      headSha: session.head_sha,
      status: session.status,
      prPurpose: session.pr_purpose,
      changeSummary: this.toStringArray(session.change_summary),
      recommendedReviewOrder: session.recommended_review_order,
      cautionPoints: this.toStringArray(session.caution_points),
      reviewedCount: Number(session.reviewed_count),
      totalFileCount: Number(session.total_file_count),
      conflictStatus: session.conflict_status,
      conflictCheckedAt: this.toNullableIsoString(session.conflict_checked_at),
      createdByUserId: session.created_by_user_id,
      createdAt: this.toIsoString(session.created_at),
      updatedAt: this.toIsoString(session.updated_at)
    };
  }

  private mapSummary(summary: PrReviewSummaryRow): PrReviewSummaryPayload {
    const reviewedCount = Number(summary.reviewed_count);
    const totalFileCount = Number(summary.total_file_count);

    return {
      reviewSessionId: summary.id,
      pullRequestId: summary.pull_request_id,
      githubNumber: Number(summary.pr_number),
      title: summary.title,
      authorName: summary.author_login,
      authorAvatarUrl: summary.author_avatar_url,
      githubCreatedAt: this.toNullableIsoString(summary.github_created_at),
      githubUpdatedAt: this.toNullableIsoString(summary.github_updated_at),
      headBranch: summary.head_branch,
      baseBranch: summary.base_branch,
      changedFilesCount: Number(summary.changed_files_count),
      additions: Number(summary.additions),
      deletions: Number(summary.deletions),
      commitsCount: Number(summary.commits_count),
      githubUrl: summary.html_url,
      headSha: summary.head_sha,
      status: summary.status,
      prPurpose: summary.pr_purpose,
      changeSummary: this.toStringArray(summary.change_summary),
      recommendedReviewOrder: summary.recommended_review_order,
      cautionPoints: this.toStringArray(summary.caution_points),
      reviewedCount,
      totalFileCount,
      conflictStatus: summary.conflict_status,
      conflictCheckedAt: this.toNullableIsoString(summary.conflict_checked_at),
      readyToSubmit: reviewedCount === totalFileCount
    };
  }

  private mapFlow(flow: ReviewFlowListRow): PrReviewFlowPayload {
    return {
      id: flow.id,
      reviewSessionId: flow.session_id,
      title: flow.title,
      description: flow.description,
      sortOrder: Number(flow.sort_order),
      fileCount: Number(flow.file_count)
    };
  }

  private mapFlowFile(file: ReviewFlowFileRow): PrReviewFlowFilePayload {
    const workflowOrder = Number(file.workflow_order);

    return {
      id: file.id,
      reviewSessionId: file.session_id,
      flowId: file.flow_id,
      reviewFileId: file.review_file_id,
      workflowOrder,
      filePath: file.file_path,
      fileName: file.file_name,
      fileStatus: file.file_status,
      fileRole: file.file_role,
      currentStatus: file.current_status,
      fileNodeData: {
        reviewFileId: file.review_file_id,
        reviewSessionId: file.session_id,
        reviewFlowFileId: file.id,
        flowId: file.flow_id,
        workflowOrder,
        fileName: file.file_name,
        filePath: file.file_path,
        roleSummary: file.file_role,
        reviewStatus: file.current_status
      }
    };
  }

  private mapReviewFile(
    file: ReviewFileDetailRow,
    memberships: ReviewFileFlowMembershipRow[]
  ): PrReviewFilePayload {
    return {
      id: file.id,
      sessionId: file.session_id,
      filePath: file.file_path,
      previousFilePath: file.previous_file_path,
      fileName: file.file_name,
      fileStatus: file.file_status,
      additions: Number(file.additions),
      deletions: Number(file.deletions),
      isBinary: file.is_binary,
      isLargeDiff: file.is_large_diff,
      githubFileUrl: file.github_file_url,
      fileRole: file.file_role,
      changeReason: file.change_reason,
      changeSummary: file.change_summary,
      reviewPoints: this.toStringArray(file.review_points),
      currentStatus: file.current_status,
      comment: file.comment,
      reviewedByUserId: file.reviewed_by_user_id,
      reviewedAt: this.toNullableIsoString(file.reviewed_at),
      flowMemberships: memberships.map((membership) => ({
        reviewFlowFileId: membership.review_flow_file_id,
        flowId: membership.flow_id,
        flowTitle: membership.flow_title,
        workflowOrder: Number(membership.workflow_order)
      })),
      latestDecision: file.latest_decision_id
        ? {
            id: file.latest_decision_id,
            status: file.latest_decision_status ?? "unknown",
            comment: file.latest_decision_comment,
            reviewedByUserId: file.latest_decision_reviewed_by_user_id,
            reviewedAt: this.toNullableIsoString(file.latest_decision_reviewed_at)
          }
        : null
    };
  }

  private mapDecision(
    decision: ReviewFileDecisionRow
  ): PrReviewFileDecisionPayload {
    return {
      id: decision.id,
      reviewFileId: decision.review_file_id,
      status: decision.status,
      comment: decision.comment,
      reviewedByUserId: decision.reviewed_by_user_id,
      reviewedAt: this.toIsoString(decision.reviewed_at)
    };
  }

  private countReviewStatuses(
    files: ReviewFileResultRow[]
  ): PrReviewStatusCountsPayload {
    const counts: PrReviewStatusCountsPayload = {
      approved: 0,
      discussionNeeded: 0,
      unknown: 0,
      notReviewed: 0,
      total: files.length
    };

    for (const file of files) {
      switch (file.current_status) {
        case "approved":
          counts.approved += 1;
          break;
        case "discussion_needed":
          counts.discussionNeeded += 1;
          break;
        case "unknown":
          counts.unknown += 1;
          break;
        case "not_reviewed":
          counts.notReviewed += 1;
          break;
      }
    }

    return counts;
  }

  private buildReviewResultSummary(counts: PrReviewStatusCountsPayload): string {
    return [
      `문제 없음 ${counts.approved}개`,
      `논의·수정 필요 ${counts.discussionNeeded}개`,
      `판단 불가 ${counts.unknown}개`,
      `미리뷰 ${counts.notReviewed}개`
    ].join(" / ");
  }

  private isReadyToSubmit(counts: PrReviewStatusCountsPayload): boolean {
    return counts.notReviewed === 0;
  }

  private buildCanvasEdges(
    flows: PrReviewCanvasFlowPayload[]
  ): PrReviewCanvasEdgePayload[] {
    const edges: PrReviewCanvasEdgePayload[] = [];

    for (const flow of flows) {
      const files = [...flow.files].sort(
        (left, right) =>
          left.workflowOrder - right.workflowOrder ||
          left.reviewFileId.localeCompare(right.reviewFileId)
      );

      for (let index = 1; index < files.length; index += 1) {
        edges.push({
          fromReviewFileId: files[index - 1].reviewFileId,
          toReviewFileId: files[index].reviewFileId,
          flowId: flow.id,
          reason: "리뷰 순서"
        });
      }
    }

    return edges;
  }

  private toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is string => typeof item === "string");
  }

  private toNullableIsoString(value: Date | string | null): string | null {
    return value === null ? null : this.toIsoString(value);
  }

  private toIsoString(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }
}
