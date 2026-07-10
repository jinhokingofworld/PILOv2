import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import {
  ApiError,
  badRequest,
  conflict as conflictError,
  notFound
} from "../../common/api-error";
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
  extractContentConflictHunks,
  type PrReviewConflictHunkPayload
} from "./pr-review-conflict-analyzer";
import type { PrReviewResolvedHunkPayload } from "./pr-review-conflict-resolution";
import {
  PrReviewAnalysisService,
  type PrReviewConflictSuggestionResult,
  type PrReviewAnalysisResult,
  type ReviewFileMetadata
} from "./pr-review-analysis.service";
import { PrReviewGithubDependencyService } from "./pr-review-github-dependency.service";
import type {
  PrReviewConflictStatus,
  PrReviewFileRiskLevel,
  PrReviewFileReviewStatus,
  PrReviewFileStatus,
  PrReviewGithubChangedFile,
  PrReviewGithubPullRequestDetail,
  PrReviewGithubPullRequestMergePayload,
  PrReviewGithubReviewSubmissionPayload,
  PrReviewGithubReviewSubmitType,
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
  pull_request_state: string;
  pull_request_mergeable: boolean | null;
  pull_request_merged_at: Date | string | null;
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
  risk_level: PrReviewFileRiskLevel;
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

interface ReviewCanvasFallbackFileRow extends QueryResultRow {
  id: string;
  session_id: string;
  file_path: string;
  file_name: string;
  file_status: PrReviewFileStatus;
  file_role: string | null;
  risk_level: PrReviewFileRiskLevel | null;
  current_status: PrReviewFileReviewStatus;
  workflow_order: number | string;
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
  risk_level: PrReviewFileRiskLevel;
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

interface ReviewFileConflictTargetRow extends QueryResultRow {
  id: string;
  file_path: string;
  previous_file_path: string | null;
  file_status: PrReviewFileStatus;
  is_binary: boolean;
  is_large_diff: boolean;
}

interface ReviewFileConflictSuggestionTargetRow
  extends ReviewFileConflictTargetRow {
  session_id: string;
  pull_request_id: string;
  head_sha: string;
  conflict_status: PrReviewConflictStatus;
}

type PrReviewDecisionStatus = Exclude<PrReviewFileReviewStatus, "not_reviewed">;
type PrReviewSubmissionStatus =
  | "not_submitted"
  | "submitting"
  | "submitted"
  | "failed";

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

interface ReviewSubmissionRow extends QueryResultRow {
  id: string;
  session_id: string;
  submitted_by_user_id: string;
  submitted_by_github_login: string;
  submit_type: PrReviewGithubReviewSubmitType;
  review_body: string;
  review_result_summary: string | null;
  file_review_results: unknown;
  github_submit_status: PrReviewSubmissionStatus;
  github_review_id: string | null;
  github_review_url: string | null;
  error_message: string | null;
  submitted_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
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

interface PrReviewSubmissionDraft {
  submitType?: unknown;
  reviewBody?: unknown;
}

interface PrReviewConflictApplyDraft {
  resolvedContent?: unknown;
  expectedHeadSha?: unknown;
  expectedHeadBlobSha?: unknown;
}

interface PrReviewMergeDraft {
  expectedHeadSha?: unknown;
  confirm?: unknown;
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
  pullRequestState: "open" | "closed";
  pullRequestMergeable: boolean | null;
  pullRequestMergedAt: string | null;
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
  riskLevel: PrReviewFileRiskLevel;
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
  riskLevel: PrReviewFileRiskLevel;
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
  riskLevel: PrReviewFileRiskLevel;
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

export type PrReviewConflictFileType =
  | "content"
  | "modify_delete"
  | "rename_modify"
  | "add_add"
  | "unsupported";

export type PrReviewConflictResolutionStatus =
  | "unresolved"
  | "suggested"
  | "applied";

export interface PrReviewConflictFilePayload {
  reviewFileId: string;
  filePath: string;
  previousFilePath: string | null;
  type: PrReviewConflictFileType;
  isSupported: true;
  resolutionStatus: PrReviewConflictResolutionStatus;
  headBlobSha: string;
  headContent: string;
  hunks: PrReviewConflictHunkPayload[];
  aiSummary: string | null;
  aiSuggestion: string | null;
  resolvedContent: string | null;
}

export interface PrReviewUnsupportedConflictFilePayload {
  reviewFileId: string;
  filePath: string;
  type: "unsupported";
  reason: string;
}

export interface PrReviewConflictAnalysisPayload {
  reviewSessionId: string;
  pullRequestId: string;
  headSha: string;
  baseSha: string;
  conflictStatus: PrReviewConflictStatus;
  analysisMode: "sync";
  stored: false;
  supportedTypes: ["content"];
  files: PrReviewConflictFilePayload[];
  unsupportedFiles: PrReviewUnsupportedConflictFilePayload[];
}

export type PrReviewConflictSuggestionStatus = "suggested" | "invalid";

export interface PrReviewConflictSuggestionPayload {
  reviewFileId: string;
  filePath: string;
  previousFilePath: string | null;
  type: "content";
  status: PrReviewConflictSuggestionStatus;
  headSha: string;
  headBlobSha: string;
  aiSummary: string;
  aiSuggestion: string;
  resolvedHunks: PrReviewResolvedHunkPayload[];
  resolvedContent: string;
  validationMessages: string[];
  stored: false;
}

export interface PrReviewConflictApplyPayload {
  reviewFileId: string;
  filePath: string;
  type: "content";
  status: "applied";
  appliedByGithubLogin: string;
  commitSha: string;
  commitUrl: string | null;
  headShaBefore: string;
  headShaAfter: string;
  headBlobShaBefore: string;
  headBlobShaAfter: string;
  conflictStatus: PrReviewConflictStatus;
  conflictCheckedAt: string | null;
}

export interface PrReviewSubmissionFileResultPayload {
  fileName: string;
  filePath: string;
  status: PrReviewFileReviewStatus;
  comment: string | null;
}

export interface PrReviewSubmissionListItemPayload {
  id: string;
  sessionId: string;
  submitType: PrReviewGithubReviewSubmitType;
  githubSubmitStatus: PrReviewSubmissionStatus;
  githubReviewId: string | null;
  githubReviewUrl: string | null;
  submittedByUserId: string;
  submittedByGithubLogin: string;
  errorMessage: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PrReviewSubmissionPayload extends PrReviewSubmissionListItemPayload {
  reviewBody: string;
  reviewResultSummary: string | null;
  fileReviewResults: PrReviewSubmissionFileResultPayload[];
}

export interface PrReviewSubmissionListPayload {
  reviewSessionId: string;
  submissions: PrReviewSubmissionListItemPayload[];
}

export interface PrReviewMergePayload {
  reviewSessionId: string;
  pullRequestId: string;
  status: "merged";
  mergedByGithubLogin: string;
  mergeMethod: "merge";
  mergeCommitSha: string;
  mergeCommitUrl: string | null;
  pullRequestState: "closed";
  mergedAt: string | null;
  headSha: string;
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
const REVIEW_SUBMIT_TYPES: readonly PrReviewGithubReviewSubmitType[] = [
  "COMMENT",
  "APPROVE",
  "REQUEST_CHANGES"
];

const LARGE_DIFF_LINE_THRESHOLD = 1000;
const LARGE_DIFF_PATCH_BYTES = 200 * 1024;
const MAX_CONFLICT_APPLY_CONTENT_CHARS = 200 * 1024;
const CONFLICT_MARKER_PATTERN = /(^|\n)(<<<<<<<|=======|>>>>>>>)(?:\s|$)/;

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

  async getReviewSessionConflicts(
    currentUserId: string,
    workspaceId: string,
    reviewSessionId: string
  ): Promise<PrReviewConflictAnalysisPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const session = await this.findReviewSession(workspaceId, reviewSessionId);
    if (!session) {
      throw notFound("Review session not found");
    }

    const currentPullRequest = await this.githubDependency.getPullRequestDetail(
      currentUserId,
      workspaceId,
      session.pull_request_id
    );
    if (currentPullRequest.headSha !== session.head_sha) {
      throw conflictError("Review session head SHA is stale");
    }

    if (!currentPullRequest.baseSha) {
      throw badRequest("GitHub pull request base SHA is not synced");
    }

    if (session.conflict_status !== "conflicted") {
      return this.buildConflictAnalysisPayload({
        session,
        baseSha: currentPullRequest.baseSha,
        files: [],
        unsupportedFiles: []
      });
    }

    const reviewFiles = await this.listReviewFilesForConflictAnalysis(
      workspaceId,
      session.id
    );
    const contentCandidates: ReviewFileConflictTargetRow[] = [];
    const unsupportedFiles: PrReviewUnsupportedConflictFilePayload[] = [];

    for (const file of reviewFiles) {
      const unsupportedReason = this.getUnsupportedConflictFileReason(file);
      if (unsupportedReason) {
        unsupportedFiles.push(
          this.mapUnsupportedConflictFile(file, unsupportedReason)
        );
        continue;
      }

      contentCandidates.push(file);
    }

    if (contentCandidates.length === 0) {
      return this.buildConflictAnalysisPayload({
        session,
        baseSha: currentPullRequest.baseSha,
        files: [],
        unsupportedFiles
      });
    }

    const conflictInputs = await this.githubDependency.getPullRequestConflictInputs(
      currentUserId,
      workspaceId,
      session.pull_request_id,
      {
        baseSha: currentPullRequest.baseSha,
        headSha: session.head_sha,
        filePaths: contentCandidates.map((file) => file.file_path)
      }
    );
    const conflictInputByPath = new Map(
      conflictInputs.files.map((file) => [file.filePath, file])
    );
    const files: PrReviewConflictFilePayload[] = [];

    for (const file of contentCandidates) {
      const conflictInput = conflictInputByPath.get(file.file_path);
      if (!conflictInput || conflictInput.unsupportedReason) {
        unsupportedFiles.push(
          this.mapUnsupportedConflictFile(
            file,
            conflictInput?.unsupportedReason ??
              "content conflict input is not available"
          )
        );
        continue;
      }

      if (
        conflictInput.mergeBaseContent === null ||
        conflictInput.baseContent === null ||
        conflictInput.headContent === null ||
        conflictInput.headBlobSha === null
      ) {
        unsupportedFiles.push(
          this.mapUnsupportedConflictFile(
            file,
            "content conflict input is not available"
          )
        );
        continue;
      }

      if (conflictInput.headContent.length > MAX_CONFLICT_APPLY_CONTENT_CHARS) {
        unsupportedFiles.push(
          this.mapUnsupportedConflictFile(
            file,
            "file content is too large for conflict resolution apply"
          )
        );
        continue;
      }

      const hunks = extractContentConflictHunks({
        mergeBaseContent: conflictInput.mergeBaseContent,
        baseContent: conflictInput.baseContent,
        headContent: conflictInput.headContent
      });

      if (hunks.length === 0) {
        continue;
      }

      files.push(
        this.mapContentConflictFile(
          file,
          hunks,
          conflictInput.headBlobSha,
          conflictInput.headContent
        )
      );
    }

    return this.buildConflictAnalysisPayload({
      session,
      baseSha: currentPullRequest.baseSha,
      files,
      unsupportedFiles
    });
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

    try {
      const [flows, flowFiles] = await Promise.all([
        this.listReviewFlowsForSession(workspaceId, reviewSessionId),
        this.listReviewFlowFilesForSession(workspaceId, reviewSessionId)
      ]);
      const canvasFlows = this.buildCanvasFlows(flows, flowFiles);

      if (this.shouldUseCanvasFallback(summary, canvasFlows)) {
        return this.buildFallbackReviewSessionCanvas(
          workspaceId,
          reviewSessionId,
          summary,
          flows
        );
      }

      return this.buildReviewSessionCanvasPayload(summary, canvasFlows);
    } catch {
      return this.buildFallbackReviewSessionCanvas(
        workspaceId,
        reviewSessionId,
        summary
      );
    }
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

  async createReviewFileConflictSuggestion(
    currentUserId: string,
    workspaceId: string,
    reviewFileId: string
  ): Promise<PrReviewConflictSuggestionPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const file = await this.findReviewFileConflictSuggestionTarget(
      workspaceId,
      reviewFileId
    );
    if (!file) {
      throw notFound("Review file not found");
    }

    if (file.conflict_status !== "conflicted") {
      throw badRequest("Review session is not conflicted");
    }

    const unsupportedReason = this.getUnsupportedConflictFileReason(file);
    if (unsupportedReason) {
      throw badRequest(unsupportedReason);
    }

    const currentPullRequest = await this.githubDependency.getPullRequestDetail(
      currentUserId,
      workspaceId,
      file.pull_request_id
    );
    if (currentPullRequest.headSha !== file.head_sha) {
      throw conflictError("Review session head SHA is stale");
    }

    if (!currentPullRequest.baseSha) {
      throw badRequest("GitHub pull request base SHA is not synced");
    }

    const conflictInputs = await this.githubDependency.getPullRequestConflictInputs(
      currentUserId,
      workspaceId,
      file.pull_request_id,
      {
        baseSha: currentPullRequest.baseSha,
        headSha: file.head_sha,
        filePaths: [file.file_path]
      }
    );
    const conflictInput = conflictInputs.files.find(
      (candidate) => candidate.filePath === file.file_path
    );

    if (!conflictInput || conflictInput.unsupportedReason) {
      throw badRequest(
        conflictInput?.unsupportedReason ?? "content conflict input is not available"
      );
    }

    if (
      conflictInput.mergeBaseContent === null ||
      conflictInput.baseContent === null ||
      conflictInput.headContent === null ||
      conflictInput.headBlobSha === null
    ) {
      throw badRequest("content conflict input is not available");
    }

    if (conflictInput.headContent.length > MAX_CONFLICT_APPLY_CONTENT_CHARS) {
      throw badRequest("file content is too large for conflict resolution apply");
    }

    const hunks = extractContentConflictHunks({
      mergeBaseContent: conflictInput.mergeBaseContent,
      baseContent: conflictInput.baseContent,
      headContent: conflictInput.headContent
    });

    if (hunks.length === 0) {
      throw badRequest("Content conflict hunk not found");
    }

    const suggestion = await this.analysisService.suggestConflictResolution({
      filePath: file.file_path,
      previousFilePath: file.previous_file_path,
      headContent: conflictInput.headContent,
      hunks
    });

    return this.mapConflictSuggestion(file, conflictInput.headBlobSha, suggestion);
  }

  async applyReviewFileConflictResolution(
    currentUserId: string,
    workspaceId: string,
    reviewFileId: string,
    body: unknown
  ): Promise<PrReviewConflictApplyPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const input = this.normalizeConflictApply(body);
    const file = await this.findReviewFileConflictSuggestionTarget(
      workspaceId,
      reviewFileId
    );
    if (!file) {
      throw notFound("Review file not found");
    }

    if (file.conflict_status !== "conflicted") {
      throw badRequest("Review session is not conflicted");
    }

    const unsupportedReason = this.getUnsupportedConflictFileReason(file);
    if (unsupportedReason) {
      throw badRequest(unsupportedReason);
    }

    if (file.head_sha !== input.expectedHeadSha) {
      throw conflictError("Review session head SHA is stale");
    }

    const currentPullRequest = await this.githubDependency.getPullRequestDetail(
      currentUserId,
      workspaceId,
      file.pull_request_id
    );
    if (currentPullRequest.headSha !== file.head_sha) {
      throw conflictError("Review session head SHA is stale");
    }

    if (!currentPullRequest.baseSha) {
      throw badRequest("GitHub pull request base SHA is not synced");
    }

    const conflictInputs = await this.githubDependency.getPullRequestConflictInputs(
      currentUserId,
      workspaceId,
      file.pull_request_id,
      {
        baseSha: currentPullRequest.baseSha,
        headSha: file.head_sha,
        filePaths: [file.file_path]
      }
    );
    const conflictInput = conflictInputs.files.find(
      (candidate) => candidate.filePath === file.file_path
    );

    if (!conflictInput || conflictInput.unsupportedReason) {
      throw badRequest(
        conflictInput?.unsupportedReason ?? "content conflict input is not available"
      );
    }

    if (
      conflictInput.mergeBaseContent === null ||
      conflictInput.baseContent === null ||
      conflictInput.headContent === null ||
      conflictInput.headBlobSha === null
    ) {
      throw badRequest("content conflict input is not available");
    }

    if (conflictInput.headContent.length > MAX_CONFLICT_APPLY_CONTENT_CHARS) {
      throw badRequest("file content is too large for conflict resolution apply");
    }

    if (conflictInput.headBlobSha !== input.expectedHeadBlobSha) {
      throw conflictError("Review file blob SHA is stale");
    }

    const hunks = extractContentConflictHunks({
      mergeBaseContent: conflictInput.mergeBaseContent,
      baseContent: conflictInput.baseContent,
      headContent: conflictInput.headContent
    });

    if (hunks.length === 0) {
      throw badRequest("Content conflict hunk not found");
    }

    const applyResult = await this.githubDependency.applyPullRequestFileResolution(
      currentUserId,
      workspaceId,
      file.pull_request_id,
      {
        filePath: file.file_path,
        resolvedContent: input.resolvedContent,
        expectedHeadSha: input.expectedHeadSha,
        expectedHeadBlobSha: input.expectedHeadBlobSha
      }
    );
    const refreshedConflict =
      await this.githubDependency.getPullRequestConflictStatus(
        currentUserId,
        workspaceId,
        file.pull_request_id
      );

    await this.updateReviewSessionAfterConflictApply({
      reviewSessionId: file.session_id,
      headSha: applyResult.headShaAfter,
      conflictStatus: refreshedConflict.conflictStatus,
      conflictCheckedAt: refreshedConflict.checkedAt
    });

    return {
      reviewFileId: file.id,
      filePath: file.file_path,
      type: "content",
      status: "applied",
      appliedByGithubLogin: applyResult.appliedByGithubLogin,
      commitSha: applyResult.commitSha,
      commitUrl: applyResult.commitUrl,
      headShaBefore: applyResult.headShaBefore,
      headShaAfter: applyResult.headShaAfter,
      headBlobShaBefore: applyResult.headBlobShaBefore,
      headBlobShaAfter: applyResult.headBlobShaAfter,
      conflictStatus: refreshedConflict.conflictStatus,
      conflictCheckedAt: refreshedConflict.checkedAt
    };
  }

  async mergeReviewSession(
    currentUserId: string,
    workspaceId: string,
    reviewSessionId: string,
    body: unknown
  ): Promise<PrReviewMergePayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const input = this.normalizeReviewSessionMerge(body);
    const session = await this.findReviewSession(workspaceId, reviewSessionId);
    if (!session) {
      throw notFound("Review session not found");
    }

    this.assertReviewSessionMergeable(session);

    if (session.head_sha !== input.expectedHeadSha) {
      throw conflictError("Review session head SHA is stale");
    }

    const mergeResult: PrReviewGithubPullRequestMergePayload =
      await this.githubDependency.mergePullRequest(
        currentUserId,
        workspaceId,
        session.pull_request_id,
        {
          expectedHeadSha: input.expectedHeadSha
        }
      );

    return {
      reviewSessionId: session.id,
      pullRequestId: session.pull_request_id,
      status: "merged",
      mergedByGithubLogin: mergeResult.mergedByGithubLogin,
      mergeMethod: mergeResult.mergeMethod,
      mergeCommitSha: mergeResult.mergeCommitSha,
      mergeCommitUrl: mergeResult.mergeCommitUrl,
      pullRequestState: mergeResult.pullRequestState,
      mergedAt: mergeResult.mergedAt,
      headSha: mergeResult.headSha
    };
  }

  async submitReviewSession(
    currentUserId: string,
    workspaceId: string,
    reviewSessionId: string,
    body: unknown
  ): Promise<PrReviewSubmissionPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const session = await this.findReviewSession(workspaceId, reviewSessionId);
    if (!session) {
      throw notFound("Review session not found");
    }

    const input = this.normalizeReviewSubmission(body);
    const files = await this.listReviewFilesForSession(workspaceId, session.id);
    const counts = this.countReviewStatuses(files);
    this.assertReviewSessionSubmittable(session, counts);

    const githubOAuth = await this.githubDependency.getCurrentUserGithubOAuthStatus(
      currentUserId
    );
    if (!githubOAuth.connected || !githubOAuth.githubLogin) {
      throw badRequest("GitHub OAuth connection is required");
    }

    const currentPullRequest = await this.githubDependency.getPullRequestDetail(
      currentUserId,
      workspaceId,
      session.pull_request_id
    );
    if (currentPullRequest.headSha !== session.head_sha) {
      throw badRequest("Review session head SHA is stale");
    }

    const fileReviewResults = files.map((file) =>
      this.mapSubmissionFileResult(file)
    );
    const reviewResultSummary = this.buildReviewResultSummary(counts);
    const attempt = await this.insertReviewSubmissionAttempt({
      sessionId: session.id,
      currentUserId,
      submittedByGithubLogin: githubOAuth.githubLogin,
      submitType: input.submitType,
      reviewBody: input.reviewBody,
      reviewResultSummary,
      fileReviewResults
    });

    let submission: PrReviewGithubReviewSubmissionPayload;
    try {
      submission = await this.githubDependency.submitPullRequestReview(
        currentUserId,
        workspaceId,
        session.pull_request_id,
        {
          submitType: input.submitType,
          reviewBody: input.reviewBody
        }
      );
    } catch (error) {
      const errorMessage = this.getSafeSubmissionErrorMessage(error);
      await this.updateReviewSubmissionFailure(attempt.id, errorMessage);

      if (error instanceof ApiError) {
        throw error;
      }

      throw badRequest(errorMessage);
    }

    const savedSubmission = await this.database.transaction(
      async (transaction) => {
        const updatedSubmission = await this.updateReviewSubmissionSuccess(
          transaction,
          {
            submissionId: attempt.id,
            githubReviewId: submission.githubReviewId,
            githubReviewUrl: submission.githubReviewUrl,
            submittedAt: submission.submittedAt
          }
        );
        await this.markReviewSessionSubmitted(transaction, session.id);
        return updatedSubmission;
      }
    );

    return this.mapSubmission(savedSubmission);
  }

  async listReviewSubmissions(
    currentUserId: string,
    workspaceId: string,
    reviewSessionId: string
  ): Promise<PrReviewSubmissionListPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const session = await this.findReviewSession(workspaceId, reviewSessionId);
    if (!session) {
      throw notFound("Review session not found");
    }

    const submissions = await this.listReviewSubmissionRows(workspaceId, session.id);
    return {
      reviewSessionId: session.id,
      submissions: submissions.map((submission) =>
        this.mapSubmissionListItem(submission)
      )
    };
  }

  async getReviewSubmission(
    currentUserId: string,
    workspaceId: string,
    submissionId: string
  ): Promise<PrReviewSubmissionPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const submission = await this.findReviewSubmission(workspaceId, submissionId);
    if (!submission) {
      throw notFound("Review submission not found");
    }

    return this.mapSubmission(submission);
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

  private async updateReviewSessionAfterConflictApply(input: {
    reviewSessionId: string;
    headSha: string;
    conflictStatus: PrReviewConflictStatus;
    conflictCheckedAt: string | null;
  }): Promise<void> {
    const updated = await this.database.queryOne<{ id: string }>(
      `
        UPDATE pr_review_sessions
        SET
          head_sha = $2,
          conflict_status = $3,
          conflict_checked_at = $4,
          updated_at = now()
        WHERE id = $1
        RETURNING id
      `,
      [
        input.reviewSessionId,
        input.headSha,
        input.conflictStatus,
        input.conflictCheckedAt
      ]
    );

    if (!updated) {
      throw badRequest("Review session could not be updated");
    }
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
          pull_request.html_url,
          COALESCE(
            NULLIF(pull_request.raw->>'state', ''),
            CASE
              WHEN pull_request.merged_at IS NOT NULL
                OR pull_request.github_closed_at IS NOT NULL
                THEN 'closed'
              ELSE 'open'
            END
          ) AS pull_request_state,
          CASE
            WHEN pull_request.raw ? 'mergeable'
              AND jsonb_typeof(pull_request.raw->'mergeable') = 'boolean'
              THEN (pull_request.raw->>'mergeable')::boolean
            ELSE NULL
          END AS pull_request_mergeable,
          pull_request.merged_at AS pull_request_merged_at
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

  private async listReviewFilesForConflictAnalysis(
    workspaceId: string,
    reviewSessionId: string
  ): Promise<ReviewFileConflictTargetRow[]> {
    return this.database.query<ReviewFileConflictTargetRow>(
      `
        SELECT
          review_file.id,
          review_file.file_path,
          review_file.previous_file_path,
          review_file.file_status,
          review_file.is_binary,
          review_file.is_large_diff
        FROM review_files AS review_file
        JOIN pr_review_sessions AS review_session
          ON review_session.id = review_file.session_id
        JOIN github_pull_requests AS pull_request
          ON pull_request.id = review_session.pull_request_id
        WHERE pull_request.workspace_id = $1
          AND review_session.id = $2
        ORDER BY review_file.file_path ASC
      `,
      [workspaceId, this.requireUuid(reviewSessionId, "reviewSessionId")]
    );
  }

  private async listReviewFilesForCanvasFallback(
    workspaceId: string,
    reviewSessionId: string
  ): Promise<ReviewCanvasFallbackFileRow[]> {
    return this.database.query<ReviewCanvasFallbackFileRow>(
      `
        SELECT
          review_file.id,
          review_file.session_id,
          review_file.file_path,
          review_file.file_name,
          review_file.file_status,
          review_file.file_role,
          review_file.risk_level,
          review_file.current_status,
          ROW_NUMBER() OVER (ORDER BY review_file.file_path ASC) AS workflow_order
        FROM review_files AS review_file
        JOIN pr_review_sessions AS review_session
          ON review_session.id = review_file.session_id
        JOIN github_pull_requests AS pull_request
          ON pull_request.id = review_session.pull_request_id
        WHERE pull_request.workspace_id = $1
          AND review_session.id = $2
        ORDER BY review_file.file_path ASC
      `,
      [workspaceId, this.requireUuid(reviewSessionId, "reviewSessionId")]
    );
  }

  private async findReviewFileConflictSuggestionTarget(
    workspaceId: string,
    reviewFileId: string
  ): Promise<ReviewFileConflictSuggestionTargetRow | null> {
    if (!UUID_PATTERN.test(reviewFileId)) {
      return null;
    }

    return this.database.queryOne<ReviewFileConflictSuggestionTargetRow>(
      `
        SELECT
          review_file.id,
          review_file.session_id,
          review_session.pull_request_id,
          review_session.head_sha,
          review_session.conflict_status,
          review_file.file_path,
          review_file.previous_file_path,
          review_file.file_status,
          review_file.is_binary,
          review_file.is_large_diff
        FROM review_files AS review_file
        JOIN pr_review_sessions AS review_session
          ON review_session.id = review_file.session_id
        JOIN github_pull_requests AS pull_request
          ON pull_request.id = review_session.pull_request_id
        WHERE pull_request.workspace_id = $1
          AND review_file.id = $2
      `,
      [workspaceId, reviewFileId]
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
          review_file.risk_level,
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
          review_file.risk_level,
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
          review_file.risk_level,
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

  private async listReviewSubmissionRows(
    workspaceId: string,
    reviewSessionId: string
  ): Promise<ReviewSubmissionRow[]> {
    return this.database.query<ReviewSubmissionRow>(
      `
        SELECT
          submission.id,
          submission.session_id,
          submission.submitted_by_user_id,
          submission.submitted_by_github_login,
          submission.submit_type,
          submission.review_body,
          submission.review_result_summary,
          submission.file_review_results,
          submission.github_submit_status,
          submission.github_review_id,
          submission.github_review_url,
          submission.error_message,
          submission.submitted_at,
          submission.created_at,
          submission.updated_at
        FROM review_submissions AS submission
        JOIN pr_review_sessions AS review_session
          ON review_session.id = submission.session_id
        JOIN github_pull_requests AS pull_request
          ON pull_request.id = review_session.pull_request_id
        WHERE pull_request.workspace_id = $1
          AND review_session.id = $2
        ORDER BY submission.created_at DESC, submission.id DESC
      `,
      [workspaceId, this.requireUuid(reviewSessionId, "reviewSessionId")]
    );
  }

  private async findReviewSubmission(
    workspaceId: string,
    submissionId: string
  ): Promise<ReviewSubmissionRow | null> {
    if (!UUID_PATTERN.test(submissionId)) {
      return null;
    }

    return this.database.queryOne<ReviewSubmissionRow>(
      `
        SELECT
          submission.id,
          submission.session_id,
          submission.submitted_by_user_id,
          submission.submitted_by_github_login,
          submission.submit_type,
          submission.review_body,
          submission.review_result_summary,
          submission.file_review_results,
          submission.github_submit_status,
          submission.github_review_id,
          submission.github_review_url,
          submission.error_message,
          submission.submitted_at,
          submission.created_at,
          submission.updated_at
        FROM review_submissions AS submission
        JOIN pr_review_sessions AS review_session
          ON review_session.id = submission.session_id
        JOIN github_pull_requests AS pull_request
          ON pull_request.id = review_session.pull_request_id
        WHERE pull_request.workspace_id = $1
          AND submission.id = $2
      `,
      [workspaceId, submissionId]
    );
  }

  private async insertReviewSubmissionAttempt(input: {
    sessionId: string;
    currentUserId: string;
    submittedByGithubLogin: string;
    submitType: PrReviewGithubReviewSubmitType;
    reviewBody: string;
    reviewResultSummary: string;
    fileReviewResults: PrReviewSubmissionFileResultPayload[];
  }): Promise<ReviewSubmissionRow> {
    const submission = await this.database.queryOne<ReviewSubmissionRow>(
      `
        INSERT INTO review_submissions (
          session_id,
          submitted_by_user_id,
          submitted_by_github_login,
          submit_type,
          review_body,
          review_result_summary,
          file_review_results,
          github_submit_status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'submitting')
        RETURNING
          id,
          session_id,
          submitted_by_user_id,
          submitted_by_github_login,
          submit_type,
          review_body,
          review_result_summary,
          file_review_results,
          github_submit_status,
          github_review_id,
          github_review_url,
          error_message,
          submitted_at,
          created_at,
          updated_at
      `,
      [
        input.sessionId,
        input.currentUserId,
        input.submittedByGithubLogin,
        input.submitType,
        input.reviewBody,
        input.reviewResultSummary,
        JSON.stringify(input.fileReviewResults)
      ]
    );

    if (!submission) {
      throw badRequest("Review submission could not be saved");
    }

    return submission;
  }

  private async updateReviewSubmissionSuccess(
    transaction: DatabaseTransaction,
    input: {
      submissionId: string;
      githubReviewId: string | null;
      githubReviewUrl: string | null;
      submittedAt: string;
    }
  ): Promise<ReviewSubmissionRow> {
    const submission = await transaction.queryOne<ReviewSubmissionRow>(
      `
        UPDATE review_submissions
        SET github_submit_status = 'submitted',
            github_review_id = $2,
            github_review_url = $3,
            error_message = NULL,
            submitted_at = $4
        WHERE id = $1
        RETURNING
          id,
          session_id,
          submitted_by_user_id,
          submitted_by_github_login,
          submit_type,
          review_body,
          review_result_summary,
          file_review_results,
          github_submit_status,
          github_review_id,
          github_review_url,
          error_message,
          submitted_at,
          created_at,
          updated_at
      `,
      [
        input.submissionId,
        input.githubReviewId,
        input.githubReviewUrl,
        input.submittedAt
      ]
    );

    if (!submission) {
      throw badRequest("Review submission could not be updated");
    }

    return submission;
  }

  private async updateReviewSubmissionFailure(
    submissionId: string,
    errorMessage: string
  ): Promise<void> {
    const submission = await this.database.queryOne<{ id: string }>(
      `
        UPDATE review_submissions
        SET github_submit_status = 'failed',
            error_message = $2
        WHERE id = $1
        RETURNING id
      `,
      [submissionId, errorMessage]
    );

    if (!submission) {
      throw badRequest("Review submission could not be updated");
    }
  }

  private async markReviewSessionSubmitted(
    transaction: DatabaseTransaction,
    reviewSessionId: string
  ): Promise<void> {
    const session = await transaction.queryOne<{ id: string }>(
      `
        UPDATE pr_review_sessions
        SET status = 'submitted'
        WHERE id = $1
        RETURNING id
      `,
      [reviewSessionId]
    );

    if (!session) {
      throw badRequest("Review session could not be marked as submitted");
    }
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
        WHERE review_file.id = $2
          AND review_file.session_id = review_session.id
          AND pull_request.workspace_id = $1
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
          risk_level,
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
          $14,
          $15::jsonb
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
        metadata.riskLevel,
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

  private buildConflictAnalysisPayload(input: {
    session: PrReviewSessionRow;
    baseSha: string;
    files: PrReviewConflictFilePayload[];
    unsupportedFiles: PrReviewUnsupportedConflictFilePayload[];
  }): PrReviewConflictAnalysisPayload {
    return {
      reviewSessionId: input.session.id,
      pullRequestId: input.session.pull_request_id,
      headSha: input.session.head_sha,
      baseSha: input.baseSha,
      conflictStatus: input.session.conflict_status,
      analysisMode: "sync",
      stored: false,
      supportedTypes: ["content"],
      files: input.files,
      unsupportedFiles: input.unsupportedFiles
    };
  }

  private mapContentConflictFile(
    file: ReviewFileConflictTargetRow,
    hunks: PrReviewConflictHunkPayload[],
    headBlobSha: string,
    headContent: string
  ): PrReviewConflictFilePayload {
    return {
      reviewFileId: file.id,
      filePath: file.file_path,
      previousFilePath: file.previous_file_path,
      type: "content",
      isSupported: true,
      resolutionStatus: "unresolved",
      headBlobSha,
      headContent,
      hunks,
      aiSummary: null,
      aiSuggestion: null,
      resolvedContent: null
    };
  }

  private mapUnsupportedConflictFile(
    file: ReviewFileConflictTargetRow,
    reason: string
  ): PrReviewUnsupportedConflictFilePayload {
    return {
      reviewFileId: file.id,
      filePath: file.file_path,
      type: "unsupported",
      reason
    };
  }

  private mapConflictSuggestion(
    file: ReviewFileConflictSuggestionTargetRow,
    headBlobSha: string,
    suggestion: PrReviewConflictSuggestionResult
  ): PrReviewConflictSuggestionPayload {
    return {
      reviewFileId: file.id,
      filePath: file.file_path,
      previousFilePath: file.previous_file_path,
      type: "content",
      status:
        suggestion.validationStatus === "valid" ? "suggested" : "invalid",
      headSha: file.head_sha,
      headBlobSha,
      aiSummary: suggestion.aiSummary,
      aiSuggestion: suggestion.aiSuggestion,
      resolvedHunks: suggestion.resolvedHunks,
      resolvedContent: suggestion.resolvedContent,
      validationMessages: suggestion.validationMessages,
      stored: false
    };
  }

  private getUnsupportedConflictFileReason(
    file: ReviewFileConflictTargetRow
  ): string | null {
    if (file.is_binary) {
      return "binary conflict is not supported in the initial read-only slice";
    }

    if (file.is_large_diff) {
      return "large diff conflict is not supported in the initial read-only slice";
    }

    switch (file.file_status) {
      case "modified":
        return null;
      case "added":
        return "add/add conflict is not supported in the initial read-only slice";
      case "deleted":
        return "modify/delete conflict is not supported in the initial read-only slice";
      case "renamed":
        return "rename/modify conflict is not supported in the initial read-only slice";
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

  private normalizeConflictApply(body: unknown): {
    resolvedContent: string;
    expectedHeadSha: string;
    expectedHeadBlobSha: string;
  } {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw badRequest("Request body must be an object");
    }

    const draft = body as PrReviewConflictApplyDraft;
    if (typeof draft.resolvedContent !== "string") {
      throw badRequest("resolvedContent must be a string");
    }

    const resolvedContent = draft.resolvedContent
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    if (!resolvedContent.trim()) {
      throw badRequest("resolvedContent must not be empty");
    }

    if (resolvedContent.length > MAX_CONFLICT_APPLY_CONTENT_CHARS) {
      throw badRequest("resolvedContent is too large");
    }

    if (CONFLICT_MARKER_PATTERN.test(resolvedContent)) {
      throw badRequest("resolvedContent must not contain conflict markers");
    }

    if (
      typeof draft.expectedHeadSha !== "string" ||
      !draft.expectedHeadSha.trim()
    ) {
      throw badRequest("expectedHeadSha must not be empty");
    }

    if (
      typeof draft.expectedHeadBlobSha !== "string" ||
      !draft.expectedHeadBlobSha.trim()
    ) {
      throw badRequest("expectedHeadBlobSha must not be empty");
    }

    return {
      resolvedContent,
      expectedHeadSha: draft.expectedHeadSha.trim(),
      expectedHeadBlobSha: draft.expectedHeadBlobSha.trim()
    };
  }

  private normalizeReviewSessionMerge(body: unknown): {
    expectedHeadSha: string;
  } {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw badRequest("Request body must be an object");
    }

    const draft = body as PrReviewMergeDraft;
    if (draft.confirm !== true) {
      throw badRequest("confirm must be true");
    }

    if (
      typeof draft.expectedHeadSha !== "string" ||
      !draft.expectedHeadSha.trim()
    ) {
      throw badRequest("expectedHeadSha must not be empty");
    }

    return {
      expectedHeadSha: draft.expectedHeadSha.trim()
    };
  }

  private normalizeReviewSubmission(body: unknown): {
    submitType: PrReviewGithubReviewSubmitType;
    reviewBody: string;
  } {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw badRequest("Request body must be an object");
    }

    const draft = body as PrReviewSubmissionDraft;
    if (
      typeof draft.submitType !== "string" ||
      !this.isReviewSubmitType(draft.submitType)
    ) {
      throw badRequest("submitType must be COMMENT, APPROVE, or REQUEST_CHANGES");
    }

    if (typeof draft.reviewBody !== "string" || !draft.reviewBody.trim()) {
      throw badRequest("reviewBody must not be empty");
    }

    return {
      submitType: draft.submitType,
      reviewBody: draft.reviewBody.trim()
    };
  }

  private assertReviewSessionSubmittable(
    session: PrReviewSessionRow,
    counts: PrReviewStatusCountsPayload
  ): void {
    if (session.status === "submitted") {
      throw badRequest("Review session has already been submitted");
    }

    if (session.status === "archived") {
      throw badRequest("Review session is archived");
    }

    if (counts.total === 0) {
      throw badRequest("Review session is not ready to submit");
    }

    if (session.status !== "reviewing" && session.status !== "ready_to_submit") {
      throw badRequest("Review session is not ready to submit");
    }
  }

  private assertReviewSessionMergeable(session: PrReviewSessionRow): void {
    if (session.status !== "submitted") {
      throw badRequest("GitHub Review must be submitted before merge");
    }

    if (session.conflict_status !== "clean") {
      throw badRequest("Resolve PR conflicts before merge");
    }
  }

  private isSessionStatus(value: string): value is PrReviewSessionStatus {
    return SESSION_STATUSES.includes(value as PrReviewSessionStatus);
  }

  private isReviewDecisionStatus(value: string): value is PrReviewDecisionStatus {
    return REVIEW_DECISION_STATUSES.includes(value as PrReviewDecisionStatus);
  }

  private isReviewFileStatus(value: string): value is PrReviewFileReviewStatus {
    return value === "not_reviewed" || this.isReviewDecisionStatus(value);
  }

  private normalizeRiskLevel(value: unknown): PrReviewFileRiskLevel {
    return value === "high" ||
      value === "medium" ||
      value === "low" ||
      value === "unknown"
      ? value
      : "unknown";
  }

  private isReviewSubmitType(value: string): value is PrReviewGithubReviewSubmitType {
    return REVIEW_SUBMIT_TYPES.includes(value as PrReviewGithubReviewSubmitType);
  }

  private requireUuid(value: string, field: string): string {
    if (!UUID_PATTERN.test(value)) {
      throw badRequest(`${field} must be a valid UUID`);
    }

    return value;
  }

  private buildCanvasFlows(
    flows: ReviewFlowListRow[],
    flowFiles: ReviewFlowFileRow[]
  ): PrReviewCanvasFlowPayload[] {
    const filesByFlow = new Map<string, PrReviewFlowFilePayload[]>();

    for (const flowFile of flowFiles) {
      const payload = this.mapFlowFile(flowFile);
      const files = filesByFlow.get(payload.flowId) ?? [];
      files.push(payload);
      filesByFlow.set(payload.flowId, files);
    }

    return flows.map((flow) => ({
      ...this.mapFlow(flow),
      files: filesByFlow.get(flow.id) ?? []
    }));
  }

  private shouldUseCanvasFallback(
    summary: PrReviewSummaryRow,
    flows: PrReviewCanvasFlowPayload[]
  ): boolean {
    return (
      Number(summary.total_file_count) > 0 &&
      flows.reduce((count, flow) => count + flow.files.length, 0) === 0
    );
  }

  private async buildFallbackReviewSessionCanvas(
    workspaceId: string,
    reviewSessionId: string,
    summary: PrReviewSummaryRow,
    flows: ReviewFlowListRow[] = []
  ): Promise<PrReviewCanvasPayload> {
    const files = await this.listReviewFilesForCanvasFallback(
      workspaceId,
      reviewSessionId
    );

    if (files.length === 0) {
      return this.buildReviewSessionCanvasPayload(
        summary,
        flows.map((flow) => ({
          ...this.mapFlow(flow),
          files: []
        }))
      );
    }

    const primaryFlow = flows[0] ?? null;
    const fallbackFlowId = primaryFlow?.id ?? `${summary.id}:fallback-flow`;
    const fallbackFlow: PrReviewCanvasFlowPayload = {
      id: fallbackFlowId,
      reviewSessionId: summary.id,
      title: primaryFlow?.title ?? "PR 변경 파일 리뷰",
      description:
        primaryFlow?.description ??
        "리뷰 흐름 연결 정보를 사용할 수 없어 변경 파일 기준으로 구성했습니다.",
      sortOrder: primaryFlow ? Number(primaryFlow.sort_order) : 1,
      fileCount: files.length,
      files: files.map((file) => this.mapFallbackFlowFile(file, fallbackFlowId))
    };

    return this.buildReviewSessionCanvasPayload(summary, [fallbackFlow]);
  }

  private buildReviewSessionCanvasPayload(
    summary: PrReviewSummaryRow,
    flows: PrReviewCanvasFlowPayload[]
  ): PrReviewCanvasPayload {
    return {
      reviewSessionId: summary.id,
      headBranch: summary.head_branch,
      baseBranch: summary.base_branch,
      reviewedCount: Number(summary.reviewed_count),
      totalFileCount: Number(summary.total_file_count),
      conflictStatus: summary.conflict_status,
      flows,
      edges: this.buildCanvasEdges(flows)
    };
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
      pullRequestState:
        summary.pull_request_state === "closed" ? "closed" : "open",
      pullRequestMergeable: summary.pull_request_mergeable,
      pullRequestMergedAt: this.toNullableIsoString(
        summary.pull_request_merged_at
      ),
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
    const riskLevel = this.normalizeRiskLevel(file.risk_level);

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
      riskLevel,
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
        riskLevel,
        reviewStatus: file.current_status
      }
    };
  }

  private mapFallbackFlowFile(
    file: ReviewCanvasFallbackFileRow,
    flowId: string
  ): PrReviewFlowFilePayload {
    const workflowOrder = Number(file.workflow_order);
    const riskLevel = this.normalizeRiskLevel(file.risk_level);
    const fallbackReviewFlowFileId = `${flowId}:${file.id}:fallback`;

    return {
      id: fallbackReviewFlowFileId,
      reviewSessionId: file.session_id,
      flowId,
      reviewFileId: file.id,
      workflowOrder,
      filePath: file.file_path,
      fileName: file.file_name,
      fileStatus: file.file_status,
      fileRole: file.file_role,
      riskLevel,
      currentStatus: file.current_status,
      fileNodeData: {
        reviewFileId: file.id,
        reviewSessionId: file.session_id,
        reviewFlowFileId: fallbackReviewFlowFileId,
        flowId,
        workflowOrder,
        fileName: file.file_name,
        filePath: file.file_path,
        roleSummary: file.file_role,
        riskLevel,
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
      riskLevel: this.normalizeRiskLevel(file.risk_level),
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

  private mapSubmissionListItem(
    submission: ReviewSubmissionRow
  ): PrReviewSubmissionListItemPayload {
    return {
      id: submission.id,
      sessionId: submission.session_id,
      submitType: submission.submit_type,
      githubSubmitStatus: submission.github_submit_status,
      githubReviewId: submission.github_review_id,
      githubReviewUrl: submission.github_review_url,
      submittedByUserId: submission.submitted_by_user_id,
      submittedByGithubLogin: submission.submitted_by_github_login,
      errorMessage: submission.error_message,
      submittedAt: this.toNullableIsoString(submission.submitted_at),
      createdAt: this.toIsoString(submission.created_at),
      updatedAt: this.toIsoString(submission.updated_at)
    };
  }

  private mapSubmission(submission: ReviewSubmissionRow): PrReviewSubmissionPayload {
    return {
      ...this.mapSubmissionListItem(submission),
      reviewBody: submission.review_body,
      reviewResultSummary: submission.review_result_summary,
      fileReviewResults: this.toSubmissionFileResults(
        submission.file_review_results
      )
    };
  }

  private mapSubmissionFileResult(
    file: ReviewFileResultRow
  ): PrReviewSubmissionFileResultPayload {
    return {
      fileName: file.file_name,
      filePath: file.file_path,
      status: file.current_status,
      comment: file.comment
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

  private getSafeSubmissionErrorMessage(error: unknown): string {
    if (error instanceof ApiError) {
      const response = error.getResponse();
      if (typeof response === "object" && response !== null && "error" in response) {
        const errorPayload = response.error;
        if (
          typeof errorPayload === "object" &&
          errorPayload !== null &&
          "message" in errorPayload &&
          typeof errorPayload.message === "string" &&
          errorPayload.message.length > 0
        ) {
          return errorPayload.message;
        }
      }
    }

    return "GitHub Review submission failed";
  }

  private toSubmissionFileResults(
    value: unknown
  ): PrReviewSubmissionFileResultPayload[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.flatMap((item) => {
      if (typeof item !== "object" || item === null) {
        return [];
      }

      const result = item as Partial<PrReviewSubmissionFileResultPayload>;
      if (
        typeof result.fileName !== "string" ||
        typeof result.filePath !== "string" ||
        typeof result.status !== "string" ||
        !this.isReviewFileStatus(result.status)
      ) {
        return [];
      }

      return [
        {
          fileName: result.fileName,
          filePath: result.filePath,
          status: result.status,
          comment: typeof result.comment === "string" ? result.comment : null
        }
      ];
    });
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
