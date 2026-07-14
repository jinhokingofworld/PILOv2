import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
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
import { classifyPrReviewConflictFile } from "./pr-review-conflict-file-classifier";
import {
  PrReviewAnalysisService,
  type PrReviewConflictSuggestionCurrentDraft,
  type PrReviewConflictSuggestionDraftSource,
  type PrReviewConflictSuggestionResult,
  type PrReviewAnalysisResult,
  type ReviewFileMetadata
} from "./pr-review-analysis.service";
import { PrReviewGithubDependencyService } from "./pr-review-github-dependency.service";
import type {
  PrReviewConflictStatus,
  PrReviewAnalysisErrorCode,
  PrReviewFileRiskLevel,
  PrReviewFileRoleType,
  PrReviewFileReviewStatus,
  PrReviewFileStatus,
  PrReviewGithubChangedFile,
  PrReviewGithubConflictStatusPayload,
  PrReviewGithubPullRequestDetail,
  PrReviewGithubPullRequestMergePayload,
  PrReviewGithubReviewSubmissionPayload,
  PrReviewGithubReviewSubmitType,
  PrReviewModuleInfo,
  PrReviewRelationSource,
  PrReviewRelationType,
  PrReviewSessionStatus
} from "./types";
import { PrReviewAnalysisJobPublisherService } from "./pr-review-analysis-job-publisher.service";
import { PrReviewDecisionRealtimePublisherService } from "./pr-review-decision-realtime-publisher.service";
import { PrReviewConflictDraftRealtimePublisherService } from "./pr-review-conflict-draft-realtime-publisher.service";
import {
  buildPrReviewSemanticGraphHandoff,
  PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION,
  type PrReviewSemanticGraphHandoffPayload
} from "./pr-review-semantic-contract";
import {
  resolvePrReviewSemanticGraph,
  type PrReviewValidatedGraphFlow,
  type PrReviewValidatedSemanticGraph
} from "./pr-review-semantic-validator";
import { computeShapeContentHash } from "../canvas/canvas-shape-hash";
import {
  PR_REVIEW_FILE_NODE_SHAPE_TYPE,
  PR_REVIEW_RELATION_EDGE_SHAPE_TYPE
} from "../canvas/canvas-review-shape-policy";
import type { CanvasShapeRow } from "../canvas/canvas.types";
import {
  buildPrReviewCanvasMaterialization,
  type PrReviewCanvasMaterializationFile,
  type PrReviewCanvasMaterializationRelation
} from "./pr-review-canvas-materializer";

interface PullRequestRow extends QueryResultRow {
  id: string;
  state: string;
  github_closed_at: Date | string | null;
  merged_at: Date | string | null;
}

interface PrReviewSessionRow extends QueryResultRow {
  id: string;
  room_id: string;
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
  analysis_error_code: PrReviewAnalysisErrorCode | null;
  analysis_error_message: string | null;
  room_status?: PrReviewRoomStatus;
  pull_request_state?: string;
  pull_request_closed_at?: Date | string | null;
  pull_request_merged_at?: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

type PrReviewRoomStatus = "active" | "completed";
type PrReviewRoomCompletionReason = "merged" | "closed";

interface PrReviewRoomIdentityRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  pull_request_id: string;
  canvas_id: string;
  status: PrReviewRoomStatus;
}

interface ReviewRoomCanvasIdRow extends QueryResultRow {
  canvas_id: string;
}

interface PrReviewRoomRow extends PrReviewRoomIdentityRow {
  current_session_id: string | null;
  analyzing_session_id: string | null;
  status: PrReviewRoomStatus;
  completion_reason: PrReviewRoomCompletionReason | null;
  created_by_user_id: string | null;
  completed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  pr_number: number | string;
  title: string;
  head_branch: string | null;
  base_branch: string | null;
  html_url: string;
  pull_request_state: string;
  pull_request_merged_at: Date | string | null;
  current_head_sha: string | null;
  current_session_status: PrReviewSessionStatus | null;
  revision_count: number | string;
}

interface PrReviewAnalysisJobInputRow extends QueryResultRow {
  id: string;
  review_session_id: string;
  workspace_id: string;
  head_sha: string;
  status: string;
  room_id: string;
  pull_request_id: string;
  created_by_user_id: string | null;
  session_head_sha: string;
  session_status: PrReviewSessionStatus;
}

interface PrReviewAnalysisJobResultRow extends PrReviewAnalysisJobInputRow {}

interface PrReviewAnalysisJobQueryRunner {
  queryOne<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<T | null>;
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
  role_type: PrReviewFileRoleType;
  risk_level: PrReviewFileRiskLevel;
  current_status: PrReviewFileReviewStatus;
}

interface ReviewFlowRelationRow extends QueryResultRow {
  id: string;
  session_id: string;
  flow_id: string;
  from_review_flow_file_id: string;
  to_review_flow_file_id: string;
  from_review_file_id: string;
  to_review_file_id: string;
  relation_type: PrReviewRelationType;
  source: PrReviewRelationSource;
  confidence: number | string;
  reason: string;
}

interface ReviewFileRow extends QueryResultRow {
  id: string;
  room_file_id: string;
  current_status: PrReviewFileReviewStatus;
}

interface ReviewFileCarryOverRow extends QueryResultRow {
  source_decision_id: string;
  current_status: PrReviewFileReviewStatus;
  comment: string | null;
  reviewed_by_user_id: string;
  reviewed_at: Date | string;
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
  role_type: PrReviewFileRoleType;
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
  role_type: PrReviewFileRoleType;
  risk_level: PrReviewFileRiskLevel;
  change_reason: string | null;
  change_summary: string | null;
  review_points: unknown;
  current_status: PrReviewFileReviewStatus;
  comment: string | null;
  reviewed_by_user_id: string | null;
  reviewed_at: Date | string | null;
  decision_version: number | string;
  carried_from_decision_id: string | null;
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
  current_status: PrReviewFileReviewStatus;
  comment: string | null;
  reviewed_by_user_id: string | null;
  reviewed_at: Date | string | null;
  decision_version: number | string;
}

interface ReviewFileDecisionUpdateResult {
  file: ReviewFileDecisionTargetRow;
  changed: boolean;
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
  expectedDecisionVersion?: unknown;
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

interface PrReviewConflictSuggestionDraftInput {
  currentDraft?: unknown;
}

interface PrReviewConflictSuggestionCurrentDraftInput {
  resolvedContent?: unknown;
  hunks?: unknown;
}

interface PrReviewConflictSuggestionHunkDraftInput {
  hunkId?: unknown;
  source?: unknown;
  resolvedText?: unknown;
}

interface PrReviewConflictsApplyFileDraft {
  reviewFileId?: unknown;
  resolvedContent?: unknown;
  expectedHeadBlobSha?: unknown;
}

interface PrReviewConflictsApplyDraft {
  expectedHeadSha?: unknown;
  files?: unknown;
}

interface PrReviewConflictDraftUpdateInput {
  sourceHeadBlobSha?: unknown;
  resolvedContent?: unknown;
  expectedDraftVersion?: unknown;
}

interface PrReviewConflictDraftRow extends QueryResultRow {
  review_file_id: string;
  source_head_blob_sha: string;
  resolved_content: string;
  draft_version: number | string;
  updated_by_user_id: string;
  updated_at: Date | string;
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
  reviewRoomId: string;
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
  analysisError: PrReviewAnalysisErrorPayload | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PrReviewAnalysisErrorPayload {
  code: PrReviewAnalysisErrorCode;
  message: string;
}

export interface PrReviewSessionCreateResult {
  session: PrReviewSessionPayload;
  created: boolean;
  roomCreated: boolean;
}

export interface PrReviewRoomPayload {
  id: string;
  workspaceId: string;
  pullRequestId: string;
  canvasId: string;
  currentReviewSessionId: string | null;
  analyzingReviewSessionId: string | null;
  status: PrReviewRoomStatus;
  completionReason: PrReviewRoomCompletionReason | null;
  completedAt: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  pullRequest: {
    githubNumber: number;
    title: string;
    headBranch: string | null;
    baseBranch: string | null;
    githubUrl: string;
    state: "open" | "closed";
    mergedAt: string | null;
  };
  currentRevision: {
    reviewSessionId: string;
    headSha: string;
    status: PrReviewSessionStatus;
  } | null;
  revisionCount: number;
}

export interface PrReviewRoomStartPayload {
  room: PrReviewRoomPayload;
  revision: PrReviewSessionPayload;
  roomCreated: boolean;
  revisionCreated: boolean;
}

export interface PrReviewRoomListPayload {
  rooms: PrReviewRoomPayload[];
}

export interface PrReviewRoomRevisionListPayload {
  reviewRoomId: string;
  currentReviewSessionId: string | null;
  revisions: PrReviewSessionPayload[];
}

export interface PrReviewAnalysisInputPayload {
  jobId: string;
  reviewSessionId: string;
  workspaceId: string;
  headSha: string;
  graphSchemaVersion: typeof PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION;
  pullRequest: {
    prNumber: number;
    title: string;
    body: string | null;
    state: "open" | "closed";
    draft: boolean;
    mergeable: boolean | null;
    authorLogin: string | null;
    headBranch: string | null;
    baseBranch: string | null;
    baseSha: string | null;
    changedFilesCount: number;
    additions: number;
    deletions: number;
    commitsCount: number;
  };
  files: Array<{
    filePath: string;
    previousFilePath: string | null;
    fileName: string;
    fileStatus: PrReviewFileStatus;
    additions: number;
    deletions: number;
    isBinary: boolean;
    isLargeDiff: boolean;
    patch: string | null;
  }>;
  semanticGraph: PrReviewSemanticGraphHandoffPayload;
}

export interface PrReviewAnalysisJobCompletionPayload {
  reviewSessionId: string;
  status: "reviewing" | "failed";
  persisted: boolean;
}

interface PrReviewAnalysisResultHandoffInput {
  jobId: string;
  reviewSessionId: string;
  workspaceId: string;
  headSha: string;
  analysis: unknown;
}

interface PrReviewAnalysisFailureHandoffInput {
  jobId: string;
  reviewSessionId: string;
  workspaceId: string;
  headSha: string;
  code: PrReviewAnalysisErrorCode;
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
  roleType: PrReviewFileRoleType;
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
  roleType: PrReviewFileRoleType;
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
  id: string;
  fromReviewFileId: string;
  toReviewFileId: string;
  fromReviewFlowFileId: string;
  toReviewFlowFileId: string;
  flowId: string;
  relationType: PrReviewRelationType | "review_order";
  reason: string;
  source: PrReviewRelationSource | "fallback";
  confidence: number;
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
  roleType: PrReviewFileRoleType;
  riskLevel: PrReviewFileRiskLevel;
  changeReason: string | null;
  changeSummary: string | null;
  reviewPoints: string[];
  currentStatus: PrReviewFileReviewStatus;
  comment: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  decisionVersion: number;
  decisionCarriedOver: boolean;
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

export interface PrReviewConflictDraftPayload {
  reviewFileId: string;
  sourceHeadBlobSha: string;
  resolvedContent: string;
  draftVersion: number;
  updatedByUserId: string;
  updatedAt: string;
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
  localStateStatus: "updated" | "sync_required";
}

export interface PrReviewConflictsApplyFilePayload {
  reviewFileId: string;
  filePath: string;
  headBlobShaBefore: string;
  headBlobShaAfter: string;
}

export interface PrReviewConflictsApplyPayload {
  reviewSessionId: string;
  pullRequestId: string;
  status: "applied";
  appliedByGithubLogin: string;
  commitSha: string;
  commitUrl: string | null;
  headShaBefore: string;
  headShaAfter: string;
  files: PrReviewConflictsApplyFilePayload[];
  conflictStatus: PrReviewConflictStatus;
  conflictCheckedAt: string | null;
  localStateStatus: "updated" | "sync_required";
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

export interface DeletePrReviewRoomPayload {
  deleted: true;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ANALYSIS_FAILURE_MESSAGES: Record<PrReviewAnalysisErrorCode, string> = {
  ANALYSIS_ENQUEUE_FAILED:
    "분석 작업을 시작하지 못했습니다. 새 분석을 시작해주세요.",
  ANALYSIS_PROVIDER_FAILED:
    "분석을 완료하지 못했습니다. 잠시 후 새 분석을 시작해주세요.",
  ANALYSIS_INPUT_INVALID:
    "분석 결과를 처리하지 못했습니다. 새 분석을 시작해주세요.",
  PR_HEAD_CHANGED:
    "PR의 최신 커밋이 분석 시작 시점과 달라 새 분석이 필요합니다."
};

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
const CONFLICT_SUGGESTION_DRAFT_SOURCES: readonly PrReviewConflictSuggestionDraftSource[] = [
  "ai",
  "pr",
  "target",
  "both",
  "manual"
];
const CONFLICT_STATUS_SETTLE_MAX_ATTEMPTS = 4;
const CONFLICT_STATUS_SETTLE_DELAY_MS = 250;
const CONFLICT_MARKER_PATTERN = /(^|\n)(<<<<<<<|=======|>>>>>>>)(?:\s|$)/;

@Injectable()
export class PrReviewService {
  private readonly logger = new Logger(PrReviewService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly workspaceService: WorkspaceService,
    private readonly githubDependency: PrReviewGithubDependencyService,
    private readonly analysisService: PrReviewAnalysisService,
    private readonly analysisJobPublisher: PrReviewAnalysisJobPublisherService,
    private readonly decisionRealtimePublisher?: PrReviewDecisionRealtimePublisherService,
    private readonly conflictDraftRealtimePublisher?: PrReviewConflictDraftRealtimePublisherService
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
  ): Promise<PrReviewSessionCreateResult> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const pullRequest = await this.findSyncedPullRequest(workspaceId, pullRequestId);
    if (!pullRequest) {
      throw notFound("Pull request not found in workspace");
    }
    this.assertPullRequestReviewable(pullRequest);
    await this.syncReviewRoomLifecycle(workspaceId, { pullRequestId });

    const existing = await this.findActiveAnalyzingReviewSession(
      workspaceId,
      pullRequestId
    );
    if (existing) {
      return {
        session: this.mapSession(existing),
        created: false,
        roomCreated: false
      };
    }

    const detail = await this.githubDependency.getPullRequestDetail(
      currentUserId,
      workspaceId,
      pullRequestId
    );
    const reusable = await this.findReusableReviewSession(
      workspaceId,
      pullRequestId,
      detail.headSha
    );
    if (reusable) {
      return {
        session: this.mapSession(reusable),
        created: false,
        roomCreated: false
      };
    }

    try {
      const conflict = await this.githubDependency.getPullRequestConflictStatus(
        currentUserId,
        workspaceId,
        pullRequestId
      );
      const created = await this.database.transaction(async (transaction) => {
        const currentPullRequest = await this.findSyncedPullRequest(
          workspaceId,
          pullRequestId,
          transaction,
          true
        );
        if (!currentPullRequest) {
          throw notFound("Pull request not found in workspace");
        }
        this.assertPullRequestReviewable(currentPullRequest);

        let room = await this.findReviewRoomIdentity(
          workspaceId,
          pullRequestId,
          transaction
        );
        let roomCreated = false;
        if (!room) {
          room = await this.insertReviewRoom(transaction, {
            currentUserId,
            workspaceId,
            pullRequestId,
            title: `PR Review #${detail.prNumber} ${detail.title}`
          });
          roomCreated = true;
        }
        if (room.status === "completed") {
          throw conflictError("Completed PR Review room is read-only");
        }

        const session = await this.insertAnalyzingReviewSession(transaction, {
          roomId: room.id,
          currentUserId,
          pullRequestId,
          headSha: detail.headSha,
          conflictStatus: conflict.conflictStatus,
          conflictCheckedAt: conflict.checkedAt
        });
        const job = await this.insertReviewAnalysisJob(transaction, {
          reviewSessionId: session.id,
          workspaceId,
          headSha: detail.headSha
        });

        return { session, jobId: job.id, roomCreated };
      });

      await this.analysisJobPublisher.publishCreatedJob(created.jobId);
      return {
        session: this.mapSession(created.session),
        created: true,
        roomCreated: created.roomCreated
      };
    } catch (error) {
      if (!this.isUniqueConstraintViolation(error)) {
        throw error;
      }

      const concurrent = await this.findActiveAnalyzingReviewSession(
        workspaceId,
        pullRequestId
      );
      const reused =
        concurrent ??
        (await this.findReusableReviewSession(
          workspaceId,
          pullRequestId,
          detail.headSha
        ));
      if (!reused) {
        throw error;
      }

      return {
        session: this.mapSession(reused),
        created: false,
        roomCreated: false
      };
    }
  }

  async createOrJoinReviewRoom(
    currentUserId: string,
    workspaceId: string,
    pullRequestId: string
  ): Promise<PrReviewRoomStartPayload> {
    const created = await this.createReviewSession(
      currentUserId,
      workspaceId,
      pullRequestId
    );
    const room = await this.findReviewRoom(workspaceId, created.session.reviewRoomId);
    if (!room) {
      throw badRequest("PR Review room could not be loaded");
    }

    return {
      room: this.mapReviewRoom(room),
      revision: created.session,
      roomCreated: created.roomCreated,
      revisionCreated: created.created
    };
  }

  async getReviewRoomForPullRequest(
    currentUserId: string,
    workspaceId: string,
    pullRequestId: string
  ): Promise<PrReviewRoomPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    await this.syncReviewRoomLifecycle(workspaceId, { pullRequestId });
    const room = await this.findReviewRoomByPullRequest(workspaceId, pullRequestId);
    if (!room) {
      throw notFound("PR Review room not found");
    }
    return this.mapReviewRoom(room);
  }

  async listReviewRooms(
    currentUserId: string,
    workspaceId: string
  ): Promise<PrReviewRoomListPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    await this.syncReviewRoomLifecycle(workspaceId);
    const rooms = await this.database.query<PrReviewRoomRow>(
      `${this.reviewRoomSelectSql()}
       WHERE review_room.workspace_id = $1
       ORDER BY
         CASE review_room.status WHEN 'active' THEN 0 ELSE 1 END,
         review_room.updated_at DESC`,
      [workspaceId]
    );
    return { rooms: rooms.map((room) => this.mapReviewRoom(room)) };
  }

  async getReviewRoom(
    currentUserId: string,
    workspaceId: string,
    reviewRoomId: string
  ): Promise<PrReviewRoomPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    await this.syncReviewRoomLifecycle(workspaceId, { reviewRoomId });
    const room = await this.findReviewRoom(workspaceId, reviewRoomId);
    if (!room) {
      throw notFound("PR Review room not found");
    }
    return this.mapReviewRoom(room);
  }

  async listReviewRoomRevisions(
    currentUserId: string,
    workspaceId: string,
    reviewRoomId: string
  ): Promise<PrReviewRoomRevisionListPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    await this.syncReviewRoomLifecycle(workspaceId, { reviewRoomId });
    const room = await this.findReviewRoom(workspaceId, reviewRoomId);
    if (!room) {
      throw notFound("PR Review room not found");
    }
    const revisions = await this.listReviewSessionsForRoom(room.id);
    return {
      reviewRoomId: room.id,
      currentReviewSessionId: room.current_session_id,
      revisions: revisions.map((revision) => this.mapSession(revision))
    };
  }

  async createReviewRoomRevision(
    currentUserId: string,
    workspaceId: string,
    reviewRoomId: string
  ): Promise<PrReviewRoomStartPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    await this.syncReviewRoomLifecycle(workspaceId, { reviewRoomId });
    const room = await this.findReviewRoom(workspaceId, reviewRoomId);
    if (!room) {
      throw notFound("PR Review room not found");
    }
    if (room.status !== "active") {
      throw conflictError("Completed PR Review room is read-only");
    }
    return this.createOrJoinReviewRoom(
      currentUserId,
      workspaceId,
      room.pull_request_id
    );
  }

  async deleteReviewRoom(
    currentUserId: string,
    workspaceId: string,
    reviewRoomId: string
  ): Promise<DeletePrReviewRoomPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const roomId = this.requireUuid(reviewRoomId, "reviewRoomId");
    const deleted = await this.database.queryOne<{ id: string }>(
      `
        DELETE FROM canvas AS review_canvas
        USING pr_review_rooms AS review_room
        WHERE review_room.workspace_id = $1
          AND review_room.id = $2
          AND review_room.canvas_id = review_canvas.id
        RETURNING review_canvas.id
      `,
      [workspaceId, roomId]
    );
    if (!deleted) {
      throw notFound("PR Review room not found");
    }
    return { deleted: true };
  }

  async retryReviewSession(
    currentUserId: string,
    workspaceId: string,
    reviewSessionId: string
  ): Promise<PrReviewSessionPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const failedSession = await this.findReviewSession(workspaceId, reviewSessionId);
    if (!failedSession) {
      throw notFound("Review session not found");
    }
    if (failedSession.status !== "failed") {
      throw conflictError("Only failed review sessions can be retried");
    }

    const retried = await this.createReviewSession(
      currentUserId,
      workspaceId,
      failedSession.pull_request_id
    );
    return retried.session;
  }

  async getAnalysisJobInput(jobId: string): Promise<PrReviewAnalysisInputPayload> {
    if (!UUID_PATTERN.test(jobId)) {
      throw notFound("PR Review analysis job not found");
    }

    const job = await this.database.queryOne<PrReviewAnalysisJobInputRow>(
      `
        SELECT
          job.id,
          job.review_session_id,
          job.workspace_id,
          job.head_sha,
          job.status,
          review_session.room_id,
          review_session.pull_request_id,
          review_session.created_by_user_id,
          review_session.head_sha AS session_head_sha,
          review_session.status AS session_status
        FROM pr_review_analysis_jobs AS job
        JOIN pr_review_sessions AS review_session
          ON review_session.id = job.review_session_id
        JOIN github_pull_requests AS pull_request
          ON pull_request.id = review_session.pull_request_id
         AND pull_request.workspace_id = job.workspace_id
        WHERE job.id = $1
      `,
      [jobId]
    );

    if (!job) {
      throw notFound("PR Review analysis job not found");
    }

    if (job.session_status !== "analyzing") {
      throw conflictError("PR Review analysis session is no longer active");
    }

    if (!this.isAnalysisJobInputAvailable(job.status)) {
      throw conflictError("PR Review analysis job is not ready for input");
    }

    if (job.head_sha !== job.session_head_sha) {
      throw conflictError("PR Review analysis job head SHA is stale");
    }

    if (!job.created_by_user_id) {
      throw badRequest("PR Review analysis job has no requesting user");
    }

    const claimedJob = await this.database.queryOne<{ id: string }>(
      `
        UPDATE pr_review_analysis_jobs
        SET status = 'processing',
            published_at = COALESCE(published_at, now()),
            publish_claim_token = NULL,
            publish_claimed_at = NULL
        WHERE id = $1
          AND status IN ('publishing', 'queued', 'processing')
        RETURNING id
      `,
      [job.id]
    );

    if (!claimedJob) {
      throw conflictError("PR Review analysis job is no longer active");
    }

    const [detail, files] = await Promise.all([
      this.githubDependency.getPullRequestDetail(
        job.created_by_user_id,
        job.workspace_id,
        job.pull_request_id
      ),
      this.githubDependency.getPullRequestChangedFiles(
        job.created_by_user_id,
        job.workspace_id,
        job.pull_request_id
      )
    ]);

    if (detail.headSha !== job.head_sha) {
      throw conflictError("PR Review analysis job head SHA is stale");
    }

    const changedFiles = files.map((file) => ({
      filePath: file.filePath,
      previousFilePath: file.previousFilePath,
      fileName: file.fileName,
      fileStatus: file.fileStatus,
      additions: file.additions,
      deletions: file.deletions,
      isBinary: file.isBinary,
      isLargeDiff: file.isLargeDiff,
      patch: file.patch
    }));

    return {
      jobId: job.id,
      reviewSessionId: job.review_session_id,
      workspaceId: job.workspace_id,
      headSha: job.head_sha,
      graphSchemaVersion: PR_REVIEW_SEMANTIC_GRAPH_SCHEMA_VERSION,
      pullRequest: {
        prNumber: detail.prNumber,
        title: detail.title,
        body: detail.body,
        state: detail.state,
        draft: detail.draft,
        mergeable: detail.mergeable,
        authorLogin: detail.authorLogin,
        headBranch: detail.headBranch,
        baseBranch: detail.baseBranch,
        baseSha: detail.baseSha,
        changedFilesCount: detail.changedFilesCount,
        additions: detail.additions,
        deletions: detail.deletions,
        commitsCount: detail.commitsCount
      },
      files: changedFiles,
      semanticGraph: buildPrReviewSemanticGraphHandoff(changedFiles)
    };
  }

  async storeAnalysisJobResult(
    jobId: string,
    body: unknown
  ): Promise<PrReviewAnalysisJobCompletionPayload> {
    const input = this.parseAnalysisResultHandoffInput(jobId, body);
    const job = await this.findAnalysisJobForHandoff(jobId);

    if (!job) {
      throw notFound("PR Review analysis job not found");
    }

    this.assertAnalysisHandoffIdentity(job, input);

    if (job.status === "succeeded" && job.session_status === "reviewing") {
      return {
        reviewSessionId: job.review_session_id,
        status: "reviewing",
        persisted: false
      };
    }

    if (job.status === "failed" || job.session_status === "failed") {
      return {
        reviewSessionId: job.review_session_id,
        status: "failed",
        persisted: false
      };
    }

    if (!this.isAnalysisJobInputAvailable(job.status)) {
      throw conflictError("PR Review analysis job is not ready for result storage");
    }

    if (job.session_status !== "analyzing") {
      throw conflictError("PR Review analysis session is no longer active");
    }

    if (!job.created_by_user_id) {
      throw badRequest("PR Review analysis job has no requesting user");
    }

    const [detail, files] = await Promise.all([
      this.githubDependency.getPullRequestDetail(
        job.created_by_user_id,
        job.workspace_id,
        job.pull_request_id
      ),
      this.githubDependency.getPullRequestChangedFiles(
        job.created_by_user_id,
        job.workspace_id,
        job.pull_request_id
      )
    ]);
    const analysis = this.normalizeAnalysisResultHandoff(input.analysis, files);

    return this.database.transaction(async (transaction) => {
      const lockedJob = await this.findAnalysisJobForHandoff(jobId, transaction, true);
      if (!lockedJob) {
        throw notFound("PR Review analysis job not found");
      }

      this.assertAnalysisHandoffIdentity(lockedJob, input);

      if (
        lockedJob.status === "succeeded" &&
        lockedJob.session_status === "reviewing"
      ) {
        return {
          reviewSessionId: lockedJob.review_session_id,
          status: "reviewing",
          persisted: false
        };
      }

      if (lockedJob.status === "failed" || lockedJob.session_status === "failed") {
        return {
          reviewSessionId: lockedJob.review_session_id,
          status: "failed",
          persisted: false
        };
      }

      if (
        lockedJob.session_status !== "analyzing" ||
        !this.isAnalysisJobInputAvailable(lockedJob.status)
      ) {
        throw conflictError("PR Review analysis job is no longer active");
      }

      if (
        lockedJob.head_sha !== lockedJob.session_head_sha ||
        detail.headSha !== lockedJob.head_sha
      ) {
        await this.failAnalysisJobInTransaction(
          transaction,
          lockedJob,
          "PR_HEAD_CHANGED"
        );
        return {
          reviewSessionId: lockedJob.review_session_id,
          status: "failed",
          persisted: true
        };
      }

      await this.insertReviewGraph(
        transaction,
        lockedJob.review_session_id,
        lockedJob.room_id,
        files,
        analysis
      );
      await this.markAnalysisJobSucceeded(transaction, lockedJob.id);
      const session = await transaction.queryOne<{ id: string }>(
        `
          UPDATE pr_review_sessions
          SET status = 'reviewing',
              pr_purpose = $2,
              change_summary = $3::jsonb,
              recommended_review_order = $4,
              caution_points = $5::jsonb,
              reviewed_count = (
                SELECT COUNT(*)::integer
                FROM review_files AS review_file
                WHERE review_file.session_id = $1
                  AND review_file.current_status <> 'not_reviewed'
              ),
              total_file_count = $6,
              analysis_error_code = NULL,
              analysis_error_message = NULL
          WHERE id = $1
            AND status = 'analyzing'
          RETURNING id
        `,
        [
          lockedJob.review_session_id,
          analysis.prPurpose,
          JSON.stringify(analysis.changeSummary),
          analysis.recommendedReviewOrder,
          JSON.stringify(analysis.cautionPoints),
          files.length
        ]
      );
      if (!session) {
        throw conflictError("PR Review analysis session is no longer active");
      }

      const room = await transaction.queryOne<{ id: string }>(
        `
          UPDATE pr_review_rooms
          SET current_session_id = $2
          WHERE id = $1
          RETURNING id
        `,
        [lockedJob.room_id, lockedJob.review_session_id]
      );
      if (!room) {
        throw conflictError("PR Review room is no longer active");
      }

      return {
        reviewSessionId: lockedJob.review_session_id,
        status: "reviewing",
        persisted: true
      };
    });
  }

  async storeAnalysisJobFailure(
    jobId: string,
    body: unknown
  ): Promise<PrReviewAnalysisJobCompletionPayload> {
    const input = this.parseAnalysisFailureHandoffInput(jobId, body);

    return this.database.transaction(async (transaction) => {
      const job = await this.findAnalysisJobForHandoff(jobId, transaction, true);
      if (!job) {
        throw notFound("PR Review analysis job not found");
      }

      this.assertAnalysisHandoffIdentity(job, input);

      if (job.status === "succeeded" && job.session_status === "reviewing") {
        return {
          reviewSessionId: job.review_session_id,
          status: "reviewing",
          persisted: false
        };
      }

      if (job.status === "failed" || job.session_status === "failed") {
        return {
          reviewSessionId: job.review_session_id,
          status: "failed",
          persisted: false
        };
      }

      if (job.session_status !== "analyzing") {
        throw conflictError("PR Review analysis session is no longer active");
      }

      await this.failAnalysisJobInTransaction(transaction, job, input.code);
      return {
        reviewSessionId: job.review_session_id,
        status: "failed",
        persisted: true
      };
    });
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

    const refreshedSummary =
      await this.refreshPendingReviewSessionConflictStatus(
        currentUserId,
        workspaceId,
        summary
      );

    return this.mapSummary(refreshedSummary);
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
    const unsupportedFiles: PrReviewUnsupportedConflictFilePayload[] = [];
    const requestedPaths = Array.from(
      new Set(
        reviewFiles.flatMap((file) =>
          file.previous_file_path
            ? [file.file_path, file.previous_file_path]
            : [file.file_path]
        )
      )
    );

    if (requestedPaths.length === 0) {
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
        filePaths: requestedPaths
      }
    );
    const conflictInputByPath = new Map(
      conflictInputs.files.map((file) => [file.filePath, file])
    );
    const files: PrReviewConflictFilePayload[] = [];

    for (const file of reviewFiles) {
      const classification = classifyPrReviewConflictFile({
        fileStatus: file.file_status,
        currentPathInput: conflictInputByPath.get(file.file_path) ?? null,
        previousPathInput: file.previous_file_path
          ? conflictInputByPath.get(file.previous_file_path) ?? null
          : null
      });

      if (classification.kind === "none") {
        continue;
      }

      if (classification.kind === "unsupported") {
        unsupportedFiles.push(
          this.mapUnsupportedConflictFile(file, classification.reason)
        );
        continue;
      }

      const conflictInput = classification.input;

      if (conflictInput.unsupportedReason) {
        unsupportedFiles.push(
          this.mapUnsupportedConflictFile(
            file,
            conflictInput.unsupportedReason
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

      if (file.is_binary) {
        unsupportedFiles.push(
          this.mapUnsupportedConflictFile(
            file,
            "binary conflict is not supported in the initial read-only slice"
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

      if (file.is_large_diff) {
        unsupportedFiles.push(
          this.mapUnsupportedConflictFile(
            file,
            "large diff conflict is not supported in the initial read-only slice"
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
      const [flows, flowFiles, flowRelations] = await Promise.all([
        this.listReviewFlowsForSession(workspaceId, reviewSessionId),
        this.listReviewFlowFilesForSession(workspaceId, reviewSessionId),
        this.listReviewFlowRelationsForSession(workspaceId, reviewSessionId)
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

      return this.buildReviewSessionCanvasPayload(
        summary,
        canvasFlows,
        flowRelations.map((relation) => this.mapFlowRelation(relation))
      );
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
    const targetFile = await this.findReviewFile(workspaceId, reviewFileUuid);
    if (!targetFile) {
      throw notFound("Review file not found");
    }
    const targetSession = await this.findReviewSession(
      workspaceId,
      targetFile.session_id
    );
    if (!targetSession) {
      throw notFound("Review session not found");
    }
    this.assertReviewSessionRoomWritable(targetSession);
    const updatedFile = await this.database.transaction(async (transaction) => {
      const file = await this.updateReviewFileDecisionState(transaction, {
        workspaceId,
        reviewFileId: reviewFileUuid,
        currentUserId,
        status: input.status,
        comment: input.comment,
        expectedDecisionVersion: input.expectedDecisionVersion
      });

      if (!file) {
        return null;
      }

      if (file.changed) {
        await this.insertReviewFileDecision(transaction, {
          reviewFileId: file.file.id,
          currentUserId,
          status: input.status,
          comment: input.comment
        });
        await this.syncReviewSessionReviewProgress(
          transaction,
          file.file.session_id
        );
      }

      return {
        changed: file.changed,
        file: file.file
      };
    });

    if (!updatedFile) {
      throw notFound("Review file not found");
    }

    const [file, flowMemberships] = await Promise.all([
      this.findReviewFile(workspaceId, updatedFile.file.id),
      this.listReviewFileFlowMemberships(workspaceId, updatedFile.file.id)
    ]);

    if (!file) {
      throw notFound("Review file not found");
    }

    if (updatedFile.changed) {
      await this.decisionRealtimePublisher?.publishDecisionUpdatedSafely(file.id);
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
    reviewFileId: string,
    body: unknown
  ): Promise<PrReviewConflictSuggestionPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const file = await this.findReviewFileConflictSuggestionTarget(
      workspaceId,
      reviewFileId
    );
    if (!file) {
      throw notFound("Review file not found");
    }

    const session = await this.findReviewSession(workspaceId, file.session_id);
    if (!session) {
      throw notFound("Review session not found");
    }
    this.assertReviewSessionRoomWritable(session);

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

    const currentDraft = this.normalizeConflictSuggestionCurrentDraft(
      body,
      hunks
    );

    const suggestion = await this.analysisService.suggestConflictResolution({
      filePath: file.file_path,
      previousFilePath: file.previous_file_path,
      headContent: conflictInput.headContent,
      hunks,
      currentDraft
    });

    return this.mapConflictSuggestion(file, conflictInput.headBlobSha, suggestion);
  }

  async getReviewFileConflictDraft(
    currentUserId: string,
    workspaceId: string,
    reviewFileId: string
  ): Promise<PrReviewConflictDraftPayload | null> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const file = await this.findReviewFileConflictSuggestionTarget(
      workspaceId,
      reviewFileId
    );
    if (!file) {
      throw notFound("Review file not found");
    }

    const session = await this.findReviewSession(workspaceId, file.session_id);
    if (!session) {
      throw notFound("Review session not found");
    }

    return this.findConflictDraft(reviewFileId);
  }

  async updateReviewFileConflictDraft(
    currentUserId: string,
    workspaceId: string,
    reviewFileId: string,
    body: unknown
  ): Promise<PrReviewConflictDraftPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const input = this.normalizeConflictDraftUpdate(body);
    const file = await this.findReviewFileConflictSuggestionTarget(
      workspaceId,
      reviewFileId
    );
    if (!file) {
      throw notFound("Review file not found");
    }
    const session = await this.findReviewSession(workspaceId, file.session_id);
    if (!session) {
      throw notFound("Review session not found");
    }
    this.assertReviewSessionRoomWritable(session);

    if (file.conflict_status !== "conflicted") {
      throw conflictError("Review session is not conflicted");
    }

    const draft = await this.database.transaction(async transaction => {
      const updated = await transaction.queryOne<PrReviewConflictDraftRow>(
        `INSERT INTO pr_review_conflict_drafts (
           review_file_id,
           source_head_blob_sha,
           resolved_content,
           draft_version,
           updated_by_user_id
         )
         VALUES ($1, $2, $3, 1, $4)
         ON CONFLICT (review_file_id) DO UPDATE
         SET source_head_blob_sha = EXCLUDED.source_head_blob_sha,
             resolved_content = EXCLUDED.resolved_content,
             draft_version = pr_review_conflict_drafts.draft_version + 1,
             updated_by_user_id = EXCLUDED.updated_by_user_id
         WHERE pr_review_conflict_drafts.draft_version = $5
         RETURNING review_file_id,
                   source_head_blob_sha,
                   resolved_content,
                   draft_version,
                   updated_by_user_id,
                   updated_at`,
        [
          reviewFileId,
          input.sourceHeadBlobSha,
          input.resolvedContent,
          currentUserId,
          input.expectedDraftVersion
        ]
      );

      if (updated) return updated;

      const existing = await transaction.queryOne<PrReviewConflictDraftRow>(
        `SELECT review_file_id,
                source_head_blob_sha,
                resolved_content,
                draft_version,
                updated_by_user_id,
                updated_at
         FROM pr_review_conflict_drafts
         WHERE review_file_id = $1`,
        [reviewFileId]
      );
      if (existing) {
        throw conflictError("Conflict draft was updated by another reviewer");
      }
      throw conflictError("Conflict draft version must start at 0");
    });

    const payload = this.mapConflictDraft(draft);
    void this.conflictDraftRealtimePublisher?.publishDraftUpdatedSafely(
      reviewFileId
    );
    return payload;
  }

  async applyReviewSessionConflictResolutions(
    currentUserId: string,
    workspaceId: string,
    reviewSessionId: string,
    body: unknown
  ): Promise<PrReviewConflictsApplyPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const input = this.normalizeConflictsApply(body);
    const session = await this.findReviewSession(workspaceId, reviewSessionId);
    if (!session) {
      throw notFound("Review session not found");
    }
    this.assertReviewSessionRoomWritable(session);

    if (session.conflict_status !== "conflicted") {
      throw badRequest("Review session is not conflicted");
    }

    if (session.head_sha !== input.expectedHeadSha) {
      throw conflictError("Review session head SHA is stale");
    }

    const conflictAnalysis = await this.getReviewSessionConflicts(
      currentUserId,
      workspaceId,
      reviewSessionId
    );
    if (conflictAnalysis.unsupportedFiles.length > 0) {
      throw badRequest("Unsupported conflict files must be resolved outside PILO");
    }

    const requestedFileById = new Map(
      input.files.map((file) => [file.reviewFileId, file])
    );
    if (
      conflictAnalysis.files.length !== input.files.length ||
      conflictAnalysis.files.some(
        (file) => !requestedFileById.has(file.reviewFileId)
      )
    ) {
      throw conflictError("Review session conflict file set is stale");
    }

    const resolvedFiles = conflictAnalysis.files.map((file) => {
      const requestedFile = requestedFileById.get(file.reviewFileId);
      if (!requestedFile) {
        throw conflictError("Review session conflict file set is stale");
      }
      if (file.headBlobSha !== requestedFile.expectedHeadBlobSha) {
        throw conflictError(`Review file blob SHA is stale: ${file.filePath}`);
      }

      return {
        reviewFileId: file.reviewFileId,
        filePath: file.filePath,
        resolvedContent: requestedFile.resolvedContent,
        expectedHeadBlobSha: requestedFile.expectedHeadBlobSha
      };
    });

    const applyResult =
      await this.githubDependency.applyPullRequestConflictResolutions(
        currentUserId,
        workspaceId,
        session.pull_request_id,
        {
          files: resolvedFiles.map((file) => ({
            filePath: file.filePath,
            resolvedContent: file.resolvedContent,
            expectedHeadBlobSha: file.expectedHeadBlobSha
          })),
          expectedBaseSha: conflictAnalysis.baseSha,
          expectedHeadSha: input.expectedHeadSha
        }
      );
    let conflictStatusRefreshed = true;
    let refreshedConflict: PrReviewGithubConflictStatusPayload;
    try {
      refreshedConflict = await this.getSettledPullRequestConflictStatus(
        currentUserId,
        workspaceId,
        session.pull_request_id
      );
    } catch {
      conflictStatusRefreshed = false;
      refreshedConflict = {
        conflictStatus: "unknown",
        checkedAt: null
      };
      this.logger.warn(
        `GitHub conflict merge commit ${applyResult.commitSha} succeeded but conflict status refresh failed for ${session.pull_request_id}`
      );
    }

    let successorRevisionCreated = true;
    try {
      await this.createSuccessorReviewRevisionAfterConflictApply({
        currentUserId,
        workspaceId,
        previousSession: session,
        headShaAfter: applyResult.headShaAfter,
        conflictStatus: refreshedConflict.conflictStatus,
        conflictCheckedAt: refreshedConflict.checkedAt
      });
    } catch {
      successorRevisionCreated = false;
      this.logger.warn(
        `GitHub conflict merge commit ${applyResult.commitSha} succeeded but successor review revision creation failed for ${session.id}`
      );
    }

    const appliedFileByPath = new Map(
      applyResult.files.map((file) => [file.filePath, file])
    );

    void this.clearConflictDraftsAfterApply({
      workspaceId,
      session,
      reviewFileIds: resolvedFiles.map(file => file.reviewFileId)
    });

    return {
      reviewSessionId: session.id,
      pullRequestId: session.pull_request_id,
      status: "applied",
      appliedByGithubLogin: applyResult.appliedByGithubLogin,
      commitSha: applyResult.commitSha,
      commitUrl: applyResult.commitUrl,
      headShaBefore: applyResult.headShaBefore,
      headShaAfter: applyResult.headShaAfter,
      files: resolvedFiles.map((file) => {
        const appliedFile = appliedFileByPath.get(file.filePath);
        if (!appliedFile) {
          throw badRequest("GitHub conflict resolution result is invalid");
        }

        return {
          reviewFileId: file.reviewFileId,
          filePath: file.filePath,
          headBlobShaBefore: appliedFile.headBlobShaBefore,
          headBlobShaAfter: appliedFile.headBlobShaAfter
        };
      }),
      conflictStatus: refreshedConflict.conflictStatus,
      conflictCheckedAt: refreshedConflict.checkedAt,
      localStateStatus:
        applyResult.localCacheUpdated &&
        conflictStatusRefreshed &&
        successorRevisionCreated
          ? "updated"
          : "sync_required"
    };
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

    const session = await this.findReviewSession(workspaceId, file.session_id);
    if (!session) {
      throw notFound("Review session not found");
    }
    this.assertReviewSessionRoomWritable(session);

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

    const conflictAnalysis = await this.getReviewSessionConflicts(
      currentUserId,
      workspaceId,
      file.session_id
    );
    const conflictFile = conflictAnalysis.files[0];
    if (
      conflictAnalysis.unsupportedFiles.length > 0 ||
      conflictAnalysis.files.length !== 1 ||
      conflictFile?.reviewFileId !== file.id
    ) {
      throw badRequest("Single supported content conflict file is required");
    }

    if (conflictFile.headBlobSha !== input.expectedHeadBlobSha) {
      throw conflictError("Review file blob SHA is stale");
    }

    const applyResult = await this.githubDependency.applyPullRequestFileResolution(
      currentUserId,
      workspaceId,
      file.pull_request_id,
      {
        filePath: file.file_path,
        resolvedContent: input.resolvedContent,
        expectedBaseSha: conflictAnalysis.baseSha,
        expectedHeadSha: input.expectedHeadSha,
        expectedHeadBlobSha: input.expectedHeadBlobSha
      }
    );
    let conflictStatusRefreshed = true;
    let refreshedConflict: PrReviewGithubConflictStatusPayload;
    try {
      refreshedConflict = await this.getSettledPullRequestConflictStatus(
        currentUserId,
        workspaceId,
        file.pull_request_id
      );
    } catch {
      conflictStatusRefreshed = false;
      refreshedConflict = {
        conflictStatus: "unknown",
        checkedAt: null
      };
      this.logger.warn(
        `GitHub conflict merge commit ${applyResult.commitSha} succeeded but conflict status refresh failed for ${file.pull_request_id}`
      );
    }

    let successorRevisionCreated = true;
    try {
      const previousSession = await this.findReviewSession(
        workspaceId,
        file.session_id
      );
      if (!previousSession) {
        throw notFound("Review session not found");
      }
      await this.createSuccessorReviewRevisionAfterConflictApply({
        currentUserId,
        workspaceId,
        previousSession,
        headShaAfter: applyResult.headShaAfter,
        conflictStatus: refreshedConflict.conflictStatus,
        conflictCheckedAt: refreshedConflict.checkedAt
      });
    } catch {
      successorRevisionCreated = false;
      this.logger.warn(
        `GitHub conflict merge commit ${applyResult.commitSha} succeeded but successor review revision creation failed for ${file.session_id}`
      );
    }

    void this.clearConflictDraftsAfterApply({
      workspaceId,
      session,
      reviewFileIds: [file.id]
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
      conflictCheckedAt: refreshedConflict.checkedAt,
      localStateStatus:
        applyResult.localCacheUpdated &&
        conflictStatusRefreshed &&
        successorRevisionCreated
          ? "updated"
          : "sync_required"
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
    this.assertReviewSessionRoomWritable(session);

    this.assertReviewSessionSubmitted(session);

    if (session.head_sha !== input.expectedHeadSha) {
      throw conflictError("Review session head SHA is stale");
    }

    let refreshedConflict: PrReviewGithubConflictStatusPayload;
    try {
      refreshedConflict = await this.getSettledPullRequestConflictStatus(
        currentUserId,
        workspaceId,
        session.pull_request_id
      );
    } catch {
      throw badRequest("GitHub pull request conflict status could not be verified");
    }

    try {
      await this.updateReviewSessionConflictStatus({
        reviewSessionId: session.id,
        expectedHeadSha: session.head_sha,
        conflictStatus: refreshedConflict.conflictStatus,
        conflictCheckedAt: refreshedConflict.checkedAt
      });
    } catch {
      this.logger.warn(
        `GitHub conflict status was refreshed but review session update failed for ${session.id}`
      );
    }

    this.assertReviewSessionMergeable({
      ...session,
      conflict_status: refreshedConflict.conflictStatus,
      conflict_checked_at: refreshedConflict.checkedAt
    });

    const mergeResult: PrReviewGithubPullRequestMergePayload =
      await this.githubDependency.mergePullRequest(
        currentUserId,
        workspaceId,
        session.pull_request_id,
        {
          expectedHeadSha: input.expectedHeadSha
        }
      );

    try {
      await this.database.execute(
        `
          UPDATE pr_review_rooms
          SET status = 'completed',
              completion_reason = 'merged',
              completed_at = COALESCE($2::timestamptz, now())
          WHERE id = $1
        `,
        [session.room_id, mergeResult.mergedAt]
      );
    } catch {
      this.logger.warn(
        `GitHub pull request was merged but review room completion failed for ${session.room_id}`
      );
    }

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
    this.assertReviewSessionRoomWritable(session);

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
        SET status = $3,
            analysis_error_code = CASE
              WHEN $3 = 'failed' THEN review_session.analysis_error_code
              ELSE NULL
            END,
            analysis_error_message = CASE
              WHEN $3 = 'failed' THEN review_session.analysis_error_message
              ELSE NULL
            END
        FROM github_pull_requests AS pull_request
        WHERE review_session.pull_request_id = pull_request.id
          AND pull_request.workspace_id = $1
          AND review_session.id = $2
        RETURNING
          review_session.id,
          review_session.room_id,
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
          review_session.analysis_error_code,
          review_session.analysis_error_message,
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

  private async createSuccessorReviewRevisionAfterConflictApply(input: {
    currentUserId: string;
    workspaceId: string;
    previousSession: PrReviewSessionRow;
    headShaAfter: string;
    conflictStatus: PrReviewConflictStatus;
    conflictCheckedAt: string | null;
  }): Promise<void> {
    if (input.previousSession.head_sha === input.headShaAfter) {
      throw conflictError("Successor review revision head SHA is stale");
    }

    const existing = await this.findReusableReviewSession(
      input.workspaceId,
      input.previousSession.pull_request_id,
      input.headShaAfter
    );
    if (existing) {
      if (existing.room_id !== input.previousSession.room_id) {
        throw conflictError("Successor review revision room does not match");
      }
      return;
    }

    try {
      const created = await this.database.transaction(async (transaction) => {
        const session = await this.insertAnalyzingReviewSession(transaction, {
          roomId: input.previousSession.room_id,
          currentUserId: input.currentUserId,
          pullRequestId: input.previousSession.pull_request_id,
          headSha: input.headShaAfter,
          conflictStatus: input.conflictStatus,
          conflictCheckedAt: input.conflictCheckedAt
        });
        const job = await this.insertReviewAnalysisJob(transaction, {
          reviewSessionId: session.id,
          workspaceId: input.workspaceId,
          headSha: input.headShaAfter
        });
        return { session, jobId: job.id };
      });
      await this.analysisJobPublisher.publishCreatedJob(created.jobId);
      return;
    } catch (error) {
      if (!this.isUniqueConstraintViolation(error)) {
        throw error;
      }
    }

    const concurrent = await this.findReusableReviewSession(
      input.workspaceId,
      input.previousSession.pull_request_id,
      input.headShaAfter
    );
    if (!concurrent || concurrent.room_id !== input.previousSession.room_id) {
      throw conflictError("Successor review revision head SHA is stale");
    }
  }

  private async refreshPendingReviewSessionConflictStatus<
    T extends PrReviewSessionRow
  >(
    currentUserId: string,
    workspaceId: string,
    session: T
  ): Promise<T> {
    if (
      session.conflict_status !== "checking" &&
      session.conflict_status !== "unknown"
    ) {
      return session;
    }

    try {
      const conflict = await this.getSettledPullRequestConflictStatus(
        currentUserId,
        workspaceId,
        session.pull_request_id
      );
      const updated = await this.updateReviewSessionConflictStatus({
        reviewSessionId: session.id,
        expectedHeadSha: session.head_sha,
        conflictStatus: conflict.conflictStatus,
        conflictCheckedAt: conflict.checkedAt
      });

      if (!updated) {
        return session;
      }

      return {
        ...session,
        conflict_status: conflict.conflictStatus,
        conflict_checked_at: conflict.checkedAt
      };
    } catch {
      this.logger.warn(
        `GitHub conflict status refresh failed for review session ${session.id}`
      );
      return session;
    }
  }

  private async getSettledPullRequestConflictStatus(
    currentUserId: string,
    workspaceId: string,
    pullRequestId: string
  ): Promise<PrReviewGithubConflictStatusPayload> {
    let conflict: PrReviewGithubConflictStatusPayload = {
      conflictStatus: "checking",
      checkedAt: null
    };

    for (
      let attempt = 1;
      attempt <= CONFLICT_STATUS_SETTLE_MAX_ATTEMPTS;
      attempt += 1
    ) {
      conflict = await this.githubDependency.getPullRequestConflictStatus(
        currentUserId,
        workspaceId,
        pullRequestId
      );

      if (
        conflict.conflictStatus !== "checking" ||
        attempt === CONFLICT_STATUS_SETTLE_MAX_ATTEMPTS
      ) {
        return conflict;
      }

      await new Promise<void>((resolve) => {
        setTimeout(resolve, CONFLICT_STATUS_SETTLE_DELAY_MS * attempt);
      });
    }

    return conflict;
  }

  private async updateReviewSessionConflictStatus(input: {
    reviewSessionId: string;
    expectedHeadSha: string;
    conflictStatus: PrReviewConflictStatus;
    conflictCheckedAt: string | null;
  }): Promise<boolean> {
    const updated = await this.database.queryOne<{ id: string }>(
      `
        UPDATE pr_review_sessions
        SET
          conflict_status = $3,
          conflict_checked_at = $4,
          updated_at = now()
        WHERE id = $1
          AND head_sha = $2
        RETURNING id
      `,
      [
        input.reviewSessionId,
        input.expectedHeadSha,
        input.conflictStatus,
        input.conflictCheckedAt
      ]
    );

    return Boolean(updated);
  }

  async deleteReviewSession(
    currentUserId: string,
    workspaceId: string,
    reviewSessionId: string
  ): Promise<DeletePrReviewSessionPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const session = await this.database.queryOne<{ room_id: string }>(
      `
        SELECT review_session.room_id
        FROM pr_review_sessions AS review_session
        JOIN pr_review_rooms AS review_room
          ON review_room.id = review_session.room_id
        WHERE review_room.workspace_id = $1
          AND review_session.id = $2
      `,
      [workspaceId, this.requireUuid(reviewSessionId, "reviewSessionId")]
    );
    if (!session) {
      throw notFound("Review session not found");
    }
    return this.deleteReviewRoom(currentUserId, workspaceId, session.room_id);
  }

  private async findSyncedPullRequest(
    workspaceId: string,
    pullRequestId: string,
    runner: PrReviewAnalysisJobQueryRunner = this.database,
    lockForShare = false
  ): Promise<PullRequestRow | null> {
    if (!UUID_PATTERN.test(pullRequestId)) {
      return null;
    }

    return runner.queryOne<PullRequestRow>(
      `
        SELECT
          id,
          COALESCE(NULLIF(raw->>'state', ''), 'open') AS state,
          github_closed_at,
          merged_at
        FROM github_pull_requests
        WHERE workspace_id = $1
          AND id = $2
        ${lockForShare ? "FOR SHARE" : ""}
      `,
      [workspaceId, pullRequestId]
    );
  }

  private assertPullRequestReviewable(pullRequest: PullRequestRow): void {
    if (
      pullRequest.state !== "open" ||
      pullRequest.github_closed_at !== null ||
      pullRequest.merged_at !== null
    ) {
      throw conflictError("Pull request is closed or merged");
    }
  }

  private async syncReviewRoomLifecycle(
    workspaceId: string,
    input: {
      pullRequestId?: string;
      reviewRoomId?: string;
    } = {}
  ): Promise<void> {
    await this.database.query(
      `
        UPDATE pr_review_rooms AS review_room
        SET status = CASE
              WHEN COALESCE(
                NULLIF(pull_request.raw->>'state', ''),
                CASE
                  WHEN pull_request.merged_at IS NOT NULL
                    OR pull_request.github_closed_at IS NOT NULL
                    THEN 'closed'
                  ELSE 'open'
                END
              ) = 'open'
              AND pull_request.github_closed_at IS NULL
              AND pull_request.merged_at IS NULL
                THEN 'active'
              ELSE 'completed'
            END,
            completion_reason = CASE
              WHEN COALESCE(
                NULLIF(pull_request.raw->>'state', ''),
                CASE
                  WHEN pull_request.merged_at IS NOT NULL
                    OR pull_request.github_closed_at IS NOT NULL
                    THEN 'closed'
                  ELSE 'open'
                END
              ) = 'open'
              AND pull_request.github_closed_at IS NULL
              AND pull_request.merged_at IS NULL
                THEN NULL
              WHEN pull_request.merged_at IS NOT NULL THEN 'merged'
              ELSE 'closed'
            END,
            completed_at = CASE
              WHEN COALESCE(
                NULLIF(pull_request.raw->>'state', ''),
                CASE
                  WHEN pull_request.merged_at IS NOT NULL
                    OR pull_request.github_closed_at IS NOT NULL
                    THEN 'closed'
                  ELSE 'open'
                END
              ) = 'open'
              AND pull_request.github_closed_at IS NULL
              AND pull_request.merged_at IS NULL
                THEN NULL
              ELSE COALESCE(
                review_room.completed_at,
                pull_request.merged_at,
                pull_request.github_closed_at,
                now()
              )
            END
        FROM github_pull_requests AS pull_request
        WHERE review_room.workspace_id = $1
          AND pull_request.id = review_room.pull_request_id
          AND pull_request.workspace_id = review_room.workspace_id
          AND ($2::uuid IS NULL OR review_room.id = $2::uuid)
          AND ($3::uuid IS NULL OR review_room.pull_request_id = $3::uuid)
          AND (
            review_room.status IS DISTINCT FROM CASE
              WHEN COALESCE(
                NULLIF(pull_request.raw->>'state', ''),
                CASE
                  WHEN pull_request.merged_at IS NOT NULL
                    OR pull_request.github_closed_at IS NOT NULL
                    THEN 'closed'
                  ELSE 'open'
                END
              ) = 'open'
              AND pull_request.github_closed_at IS NULL
              AND pull_request.merged_at IS NULL
                THEN 'active'
              ELSE 'completed'
            END
            OR review_room.completion_reason IS DISTINCT FROM CASE
              WHEN COALESCE(
                NULLIF(pull_request.raw->>'state', ''),
                CASE
                  WHEN pull_request.merged_at IS NOT NULL
                    OR pull_request.github_closed_at IS NOT NULL
                    THEN 'closed'
                  ELSE 'open'
                END
              ) = 'open'
              AND pull_request.github_closed_at IS NULL
              AND pull_request.merged_at IS NULL
                THEN NULL
              WHEN pull_request.merged_at IS NOT NULL THEN 'merged'
              ELSE 'closed'
            END
            OR (
              COALESCE(
                NULLIF(pull_request.raw->>'state', ''),
                CASE
                  WHEN pull_request.merged_at IS NOT NULL
                    OR pull_request.github_closed_at IS NOT NULL
                    THEN 'closed'
                  ELSE 'open'
                END
              ) = 'open'
              AND pull_request.github_closed_at IS NULL
              AND pull_request.merged_at IS NULL
              AND review_room.completed_at IS NOT NULL
            )
          )
      `,
      [workspaceId, input.reviewRoomId ?? null, input.pullRequestId ?? null]
    );
  }

  private assertReviewSessionRoomWritable(session: PrReviewSessionRow): void {
    if (
      session.room_status === "completed" ||
      session.pull_request_state === "closed" ||
      Boolean(session.pull_request_closed_at) ||
      Boolean(session.pull_request_merged_at)
    ) {
      throw conflictError("Completed PR Review room is read-only");
    }
  }

  private async findReviewRoomIdentity(
    workspaceId: string,
    pullRequestId: string,
    runner: PrReviewAnalysisJobQueryRunner = this.database
  ): Promise<PrReviewRoomIdentityRow | null> {
    return runner.queryOne<PrReviewRoomIdentityRow>(
      `
        SELECT id, workspace_id, pull_request_id, canvas_id, status
        FROM pr_review_rooms
        WHERE workspace_id = $1
          AND pull_request_id = $2
      `,
      [workspaceId, pullRequestId]
    );
  }

  private async insertReviewRoom(
    transaction: DatabaseTransaction,
    input: {
      currentUserId: string;
      workspaceId: string;
      pullRequestId: string;
      title: string;
    }
  ): Promise<PrReviewRoomIdentityRow> {
    const canvas = await transaction.queryOne<{ id: string }>(
      `
        INSERT INTO canvas (workspace_id, title, board_type, created_by)
        VALUES ($1, $2, 'review', $3)
        RETURNING id
      `,
      [input.workspaceId, input.title, input.currentUserId]
    );
    if (!canvas) {
      throw badRequest("PR Review canvas could not be created");
    }

    const room = await transaction.queryOne<PrReviewRoomIdentityRow>(
      `
        INSERT INTO pr_review_rooms (
          workspace_id,
          pull_request_id,
          canvas_id,
          created_by_user_id
        )
        VALUES ($1, $2, $3, $4)
        RETURNING id, workspace_id, pull_request_id, canvas_id, status
      `,
      [
        input.workspaceId,
        input.pullRequestId,
        canvas.id,
        input.currentUserId
      ]
    );
    if (!room) {
      throw badRequest("PR Review room could not be created");
    }
    return room;
  }

  private reviewRoomSelectSql(): string {
    return `
      SELECT
        review_room.id,
        review_room.workspace_id,
        review_room.pull_request_id,
        review_room.canvas_id,
        review_room.current_session_id,
        analyzing_session.id AS analyzing_session_id,
        review_room.status,
        review_room.completion_reason,
        review_room.created_by_user_id,
        review_room.completed_at,
        review_room.created_at,
        review_room.updated_at,
        pull_request.pr_number,
        pull_request.title,
        pull_request.head_branch,
        pull_request.base_branch,
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
        pull_request.merged_at AS pull_request_merged_at,
        current_session.head_sha AS current_head_sha,
        current_session.status AS current_session_status,
        (
          SELECT COUNT(*)
          FROM pr_review_sessions AS revision
          WHERE revision.room_id = review_room.id
        ) AS revision_count
      FROM pr_review_rooms AS review_room
      JOIN github_pull_requests AS pull_request
        ON pull_request.id = review_room.pull_request_id
       AND pull_request.workspace_id = review_room.workspace_id
      LEFT JOIN pr_review_sessions AS current_session
        ON current_session.id = review_room.current_session_id
      LEFT JOIN LATERAL (
        SELECT revision.id
        FROM pr_review_sessions AS revision
        WHERE revision.room_id = review_room.id
          AND revision.status = 'analyzing'
        ORDER BY revision.created_at DESC
        LIMIT 1
      ) AS analyzing_session ON true
    `;
  }

  private async findReviewRoom(
    workspaceId: string,
    reviewRoomId: string
  ): Promise<PrReviewRoomRow | null> {
    if (!UUID_PATTERN.test(reviewRoomId)) {
      return null;
    }
    return this.database.queryOne<PrReviewRoomRow>(
      `${this.reviewRoomSelectSql()}
       WHERE review_room.workspace_id = $1
         AND review_room.id = $2`,
      [workspaceId, reviewRoomId]
    );
  }

  private async findReviewRoomByPullRequest(
    workspaceId: string,
    pullRequestId: string
  ): Promise<PrReviewRoomRow | null> {
    if (!UUID_PATTERN.test(pullRequestId)) {
      return null;
    }
    return this.database.queryOne<PrReviewRoomRow>(
      `${this.reviewRoomSelectSql()}
       WHERE review_room.workspace_id = $1
         AND review_room.pull_request_id = $2`,
      [workspaceId, pullRequestId]
    );
  }

  private async findActiveAnalyzingReviewSession(
    workspaceId: string,
    pullRequestId: string
  ): Promise<PrReviewSessionRow | null> {
    const active = await this.database.queryOne<{ id: string }>(
      `
        SELECT review_session.id
        FROM pr_review_sessions AS review_session
        JOIN pr_review_rooms AS review_room
          ON review_room.id = review_session.room_id
        WHERE review_room.workspace_id = $1
          AND review_room.pull_request_id = $2
          AND review_session.status = 'analyzing'
        ORDER BY review_session.created_at DESC
        LIMIT 1
      `,
      [workspaceId, pullRequestId]
    );

    if (!active) {
      return null;
    }

    return this.findReviewSession(workspaceId, active.id);
  }

  private async findReusableReviewSession(
    workspaceId: string,
    pullRequestId: string,
    headSha: string
  ): Promise<PrReviewSessionRow | null> {
    const reusable = await this.database.queryOne<{ id: string }>(
      `
        SELECT review_session.id
        FROM pr_review_sessions AS review_session
        JOIN pr_review_rooms AS review_room
          ON review_room.id = review_session.room_id
        WHERE review_room.workspace_id = $1
          AND review_room.pull_request_id = $2
          AND review_session.head_sha = $3
          AND review_session.status <> 'failed'
        ORDER BY review_session.created_at DESC
        LIMIT 1
      `,
      [workspaceId, pullRequestId, headSha]
    );
    if (!reusable) {
      return null;
    }
    return this.findReviewSession(workspaceId, reusable.id);
  }

  private isUniqueConstraintViolation(error: unknown): boolean {
    if (typeof error !== "object" || error === null) {
      return false;
    }

    return (error as { code?: unknown }).code === "23505";
  }

  private async findAnalysisJobForHandoff(
    jobId: string,
    runner: PrReviewAnalysisJobQueryRunner = this.database,
    lock = false
  ): Promise<PrReviewAnalysisJobResultRow | null> {
    return runner.queryOne<PrReviewAnalysisJobResultRow>(
      `
        SELECT
          job.id,
          job.review_session_id,
          job.workspace_id,
          job.head_sha,
          job.status,
          review_session.room_id,
          review_session.pull_request_id,
          review_session.created_by_user_id,
          review_session.head_sha AS session_head_sha,
          review_session.status AS session_status
        FROM pr_review_analysis_jobs AS job
        JOIN pr_review_sessions AS review_session
          ON review_session.id = job.review_session_id
        JOIN github_pull_requests AS pull_request
          ON pull_request.id = review_session.pull_request_id
         AND pull_request.workspace_id = job.workspace_id
        WHERE job.id = $1
        ${lock ? "FOR UPDATE OF job, review_session" : ""}
      `,
      [jobId]
    );
  }

  private assertAnalysisHandoffIdentity(
    job: PrReviewAnalysisJobResultRow,
    input:
      | PrReviewAnalysisResultHandoffInput
      | PrReviewAnalysisFailureHandoffInput
  ): void {
    if (
      input.jobId !== job.id ||
      input.reviewSessionId !== job.review_session_id ||
      input.workspaceId !== job.workspace_id ||
      input.headSha !== job.head_sha
    ) {
      throw badRequest("PR Review analysis handoff identity does not match the job");
    }
  }

  private async markAnalysisJobSucceeded(
    transaction: DatabaseTransaction,
    jobId: string
  ): Promise<void> {
    const job = await transaction.queryOne<{ id: string }>(
      `
        UPDATE pr_review_analysis_jobs
        SET status = 'succeeded',
            published_at = COALESCE(published_at, now()),
            publish_claim_token = NULL,
            publish_claimed_at = NULL,
            error_code = NULL,
            error_message = NULL
        WHERE id = $1
          AND status IN ('publishing', 'queued', 'processing')
        RETURNING id
      `,
      [jobId]
    );

    if (!job) {
      throw conflictError("PR Review analysis job is no longer active");
    }
  }

  private async failAnalysisJobInTransaction(
    transaction: DatabaseTransaction,
    job: PrReviewAnalysisJobResultRow,
    code: PrReviewAnalysisErrorCode
  ): Promise<void> {
    const jobFailure = await transaction.queryOne<{ id: string }>(
      `
        UPDATE pr_review_analysis_jobs
        SET status = 'failed',
            publish_claim_token = NULL,
            publish_claimed_at = NULL,
            error_code = $2,
            error_message = $3
        WHERE id = $1
          AND status IN ('publishing', 'queued', 'processing')
        RETURNING id
      `,
      [job.id, code, `PR Review analysis worker terminal failure: ${code}`]
    );

    if (!jobFailure) {
      throw conflictError("PR Review analysis job is no longer active");
    }

    const sessionFailure = await transaction.queryOne<{ id: string }>(
      `
        UPDATE pr_review_sessions
        SET status = 'failed',
            analysis_error_code = $2,
            analysis_error_message = $3
        WHERE id = $1
          AND status = 'analyzing'
        RETURNING id
      `,
      [job.review_session_id, code, ANALYSIS_FAILURE_MESSAGES[code]]
    );

    if (!sessionFailure) {
      throw conflictError("PR Review analysis session is no longer active");
    }
  }

  private parseAnalysisResultHandoffInput(
    jobId: string,
    body: unknown
  ): PrReviewAnalysisResultHandoffInput {
    const identity = this.parseAnalysisHandoffIdentity(jobId, body);
    const record = this.requireRecord(body, "PR Review analysis result");

    if (!this.isRecord(record.analysis)) {
      throw badRequest("PR Review analysis result must include analysis");
    }

    return { ...identity, analysis: record.analysis };
  }

  private parseAnalysisFailureHandoffInput(
    jobId: string,
    body: unknown
  ): PrReviewAnalysisFailureHandoffInput {
    const identity = this.parseAnalysisHandoffIdentity(jobId, body);
    const record = this.requireRecord(body, "PR Review analysis failure");
    const code = this.requireHandoffText(record, "code", 80);

    if (!this.isAnalysisErrorCode(code)) {
      throw badRequest("PR Review analysis failure code is invalid");
    }

    return { ...identity, code };
  }

  private parseAnalysisHandoffIdentity(
    jobId: string,
    body: unknown
  ): Omit<PrReviewAnalysisFailureHandoffInput, "code"> {
    if (!UUID_PATTERN.test(jobId)) {
      throw notFound("PR Review analysis job not found");
    }

    const record = this.requireRecord(body, "PR Review analysis handoff");
    const bodyJobId = this.requireUuid(
      this.requireHandoffText(record, "jobId", 36),
      "jobId"
    );
    if (bodyJobId !== jobId) {
      throw badRequest("PR Review analysis handoff jobId must match the path");
    }

    return {
      jobId: bodyJobId,
      reviewSessionId: this.requireUuid(
        this.requireHandoffText(record, "reviewSessionId", 36),
        "reviewSessionId"
      ),
      workspaceId: this.requireUuid(
        this.requireHandoffText(record, "workspaceId", 36),
        "workspaceId"
      ),
      headSha: this.requireHandoffText(record, "headSha", 255)
    };
  }

  private normalizeAnalysisResultHandoff(
    value: unknown,
    files: PrReviewGithubChangedFile[]
  ): PrReviewAnalysisResult {
    const analysis = this.requireRecord(value, "PR Review analysis result");
    const rawFiles = analysis.files;
    if (!Array.isArray(rawFiles) || rawFiles.length !== files.length) {
      throw badRequest("PR Review analysis files must match the current pull request");
    }

    const metadataByPath = new Map<string, ReviewFileMetadata>();
    for (const rawFile of rawFiles) {
      const file = this.requireRecord(rawFile, "PR Review analysis file");
      const filePath = this.requireHandoffText(file, "filePath", 4000);
      if (metadataByPath.has(filePath)) {
        throw badRequest("PR Review analysis file paths must be unique");
      }

      const riskLevel = this.requireHandoffText(file, "riskLevel", 20);
      if (!this.isPrReviewFileRiskLevel(riskLevel)) {
        throw badRequest("PR Review analysis riskLevel is invalid");
      }

      metadataByPath.set(filePath, {
        filePath,
        fileRole: this.requireHandoffText(file, "fileRole", 500),
        riskLevel,
        changeReason: this.requireHandoffText(file, "changeReason", 4000),
        changeSummary: this.requireHandoffText(file, "changeSummary", 4000),
        reviewPoints: this.requireHandoffTextList(file, "reviewPoints", 50, 2000)
      });
    }

    const normalizedFiles = files.map((file) => {
      const metadata = metadataByPath.get(file.filePath);
      if (!metadata) {
        throw badRequest("PR Review analysis files must match the current pull request");
      }
      return metadata;
    });
    const semanticGraphCandidates = buildPrReviewSemanticGraphHandoff(
      files.map((file) => ({
        filePath: file.filePath,
        previousFilePath: file.previousFilePath,
        fileStatus: file.fileStatus,
        isBinary: file.isBinary,
        patch: file.patch
      }))
    );
    const semanticGraph = resolvePrReviewSemanticGraph(
      analysis,
      semanticGraphCandidates
    );
    if (semanticGraph.fallbackReason === "invalid_ai_graph") {
      this.logger.warn("Invalid PR Review AI semantic graph used deterministic fallback");
    }

    return {
      prPurpose: this.requireHandoffText(analysis, "prPurpose", 10000),
      changeSummary: this.requireHandoffTextList(analysis, "changeSummary", 100, 4000),
      recommendedReviewOrder: this.requireHandoffText(
        analysis,
        "recommendedReviewOrder",
        10000
      ),
      cautionPoints: this.requireHandoffTextList(analysis, "cautionPoints", 100, 4000),
      flowTitle: this.requireHandoffText(analysis, "flowTitle", 255),
      flowDescription: this.requireHandoffText(analysis, "flowDescription", 10000),
      files: normalizedFiles,
      semanticGraph
    };
  }

  private requireRecord(value: unknown, field: string): Record<string, unknown> {
    if (!this.isRecord(value)) {
      throw badRequest(`${field} must be an object`);
    }
    return value;
  }

  private requireHandoffText(
    record: Record<string, unknown>,
    field: string,
    maxLength: number
  ): string {
    const value = record[field];
    if (typeof value !== "string") {
      throw badRequest(`${field} must be a string`);
    }

    const normalized = value.trim();
    if (!normalized || normalized.length > maxLength) {
      throw badRequest(`${field} must be a non-empty string within ${maxLength} characters`);
    }
    return normalized;
  }

  private requireHandoffTextList(
    record: Record<string, unknown>,
    field: string,
    maxItems: number,
    maxItemLength: number
  ): string[] {
    const value = record[field];
    if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) {
      throw badRequest(`${field} must be a non-empty array`);
    }

    return value.map((item, index) => {
      if (typeof item !== "string") {
        throw badRequest(`${field}[${index}] must be a string`);
      }
      const normalized = item.trim();
      if (!normalized || normalized.length > maxItemLength) {
        throw badRequest(`${field}[${index}] is invalid`);
      }
      return normalized;
    });
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private isAnalysisErrorCode(value: string): value is PrReviewAnalysisErrorCode {
    return Object.hasOwn(ANALYSIS_FAILURE_MESSAGES, value);
  }

  private isPrReviewFileRiskLevel(
    value: string
  ): value is PrReviewFileRiskLevel {
    return value === "high" || value === "medium" || value === "low" || value === "unknown";
  }

  private isAnalysisJobInputAvailable(status: string): boolean {
    return status === "publishing" || status === "queued" || status === "processing";
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
          review_session.room_id,
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
          review_session.analysis_error_code,
          review_session.analysis_error_message,
          review_room.status AS room_status,
          COALESCE(NULLIF(pull_request.raw->>'state', ''), 'open') AS pull_request_state,
          pull_request.github_closed_at AS pull_request_closed_at,
          pull_request.merged_at AS pull_request_merged_at,
          review_session.created_at,
          review_session.updated_at
        FROM pr_review_sessions AS review_session
        JOIN pr_review_rooms AS review_room
          ON review_room.id = review_session.room_id
        JOIN github_pull_requests AS pull_request
          ON pull_request.id = review_session.pull_request_id
        WHERE pull_request.workspace_id = $1
          AND review_session.id = $2
      `,
      [workspaceId, reviewSessionId]
    );
  }

  private async findReviewRoomById(
    workspaceId: string,
    reviewRoomId: string
  ): Promise<ReviewRoomCanvasIdRow | null> {
    return this.database.queryOne<ReviewRoomCanvasIdRow>(
      `SELECT review_room.canvas_id
       FROM pr_review_rooms AS review_room
       WHERE review_room.workspace_id = $1
         AND review_room.id = $2`,
      [workspaceId, reviewRoomId]
    );
  }

  private async listReviewSessionsForRoom(
    reviewRoomId: string
  ): Promise<PrReviewSessionRow[]> {
    return this.database.query<PrReviewSessionRow>(
      `
        SELECT
          review_session.id,
          review_session.room_id,
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
          review_session.analysis_error_code,
          review_session.analysis_error_message,
          review_session.created_at,
          review_session.updated_at
        FROM pr_review_sessions AS review_session
        WHERE review_session.room_id = $1
        ORDER BY review_session.created_at DESC
      `,
      [reviewRoomId]
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
          review_session.room_id,
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
          review_session.analysis_error_code,
          review_session.analysis_error_message,
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
          review_file.role_type,
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
          review_file.role_type,
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
          review_file.role_type,
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

  private async listReviewFlowRelationsForSession(
    workspaceId: string,
    reviewSessionId: string
  ): Promise<ReviewFlowRelationRow[]> {
    return this.database.query<ReviewFlowRelationRow>(
      `
        SELECT
          relation.id,
          relation.session_id,
          relation.flow_id,
          relation.from_review_flow_file_id,
          relation.to_review_flow_file_id,
          from_flow_file.review_file_id AS from_review_file_id,
          to_flow_file.review_file_id AS to_review_file_id,
          relation.relation_type,
          relation.source,
          relation.confidence,
          relation.reason
        FROM review_flow_relations AS relation
        JOIN review_flow_files AS from_flow_file
          ON from_flow_file.session_id = relation.session_id
         AND from_flow_file.flow_id = relation.flow_id
         AND from_flow_file.id = relation.from_review_flow_file_id
        JOIN review_flow_files AS to_flow_file
          ON to_flow_file.session_id = relation.session_id
         AND to_flow_file.flow_id = relation.flow_id
         AND to_flow_file.id = relation.to_review_flow_file_id
        JOIN pr_review_sessions AS review_session
          ON review_session.id = relation.session_id
        JOIN github_pull_requests AS pull_request
          ON pull_request.id = review_session.pull_request_id
        WHERE pull_request.workspace_id = $1
          AND relation.session_id = $2
          AND relation.confidence >= 60
        ORDER BY relation.flow_id ASC, relation.confidence DESC, relation.id ASC
      `,
      [workspaceId, this.requireUuid(reviewSessionId, "reviewSessionId")]
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
          review_file.role_type,
          review_file.risk_level,
          review_file.change_reason,
          review_file.change_summary,
          review_file.review_points,
          review_file.current_status,
          review_file.comment,
          review_file.reviewed_by_user_id,
          review_file.reviewed_at,
          review_file.decision_version,
          review_file.carried_from_decision_id,
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
      expectedDecisionVersion: number;
    }
  ): Promise<ReviewFileDecisionUpdateResult | null> {
    const updated = await transaction.queryOne<ReviewFileDecisionTargetRow>(
      `
        UPDATE review_files AS review_file
        SET current_status = $3,
            comment = $4,
            reviewed_by_user_id = $5,
            reviewed_at = now(),
            decision_version = review_file.decision_version + 1,
            carried_from_decision_id = NULL
        FROM pr_review_sessions AS review_session
        JOIN github_pull_requests AS pull_request
          ON pull_request.id = review_session.pull_request_id
        WHERE review_file.id = $2
          AND review_file.session_id = review_session.id
          AND pull_request.workspace_id = $1
          AND review_file.decision_version = $6
          AND (
            review_file.current_status IS DISTINCT FROM $3
            OR review_file.comment IS DISTINCT FROM $4
          )
        RETURNING
          review_file.id,
          review_file.session_id,
          review_file.current_status,
          review_file.comment,
          review_file.reviewed_by_user_id,
          review_file.reviewed_at,
          review_file.decision_version
      `,
      [
        input.workspaceId,
        input.reviewFileId,
        input.status,
        input.comment,
        input.currentUserId,
        input.expectedDecisionVersion
      ]
    );

    if (updated) {
      return {
        file: updated,
        changed: true
      };
    }

    const current = await transaction.queryOne<ReviewFileDecisionTargetRow>(
      `
        SELECT
          review_file.id,
          review_file.session_id,
          review_file.current_status,
          review_file.comment,
          review_file.reviewed_by_user_id,
          review_file.reviewed_at,
          review_file.decision_version
        FROM review_files AS review_file
        JOIN pr_review_sessions AS review_session
          ON review_session.id = review_file.session_id
        JOIN github_pull_requests AS pull_request
          ON pull_request.id = review_session.pull_request_id
        WHERE pull_request.workspace_id = $1
          AND review_file.id = $2
      `,
      [input.workspaceId, input.reviewFileId]
    );

    if (!current) {
      return null;
    }

    if (
      current.current_status === input.status &&
      current.comment === input.comment
    ) {
      return {
        file: current,
        changed: false
      };
    }

    throw new HttpException(
      {
        success: false,
        error: {
          code: "REVIEW_DECISION_CHANGED",
          message: "Another reviewer saved a decision first",
          latestDecision: {
            decisionVersion: Number(current.decision_version),
            currentStatus: current.current_status,
            comment: current.comment,
            reviewedByUserId: current.reviewed_by_user_id,
            reviewedAt: this.toNullableIsoString(current.reviewed_at)
          }
        }
      },
      HttpStatus.CONFLICT
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
    const allFilesReviewed = reviewedCount === totalFileCount;
    const updated = await transaction.queryOne<{ id: string }>(
      `
        UPDATE pr_review_sessions AS review_session
        SET reviewed_count = $2::integer,
            total_file_count = $3::integer,
            status = CASE
              WHEN review_session.status IN ('submitted', 'archived')
                THEN review_session.status
              WHEN $4::boolean
                THEN 'ready_to_submit'
              WHEN review_session.status = 'ready_to_submit'
                THEN 'reviewing'
              ELSE review_session.status
            END
        WHERE review_session.id = $1
        RETURNING review_session.id
      `,
      [reviewSessionId, reviewedCount, totalFileCount, allFilesReviewed]
    );

    if (!updated) {
      throw badRequest("Review session progress could not be updated");
    }
  }

  private async insertAnalyzingReviewSession(
    transaction: DatabaseTransaction,
    input: {
      roomId: string;
      currentUserId: string;
      pullRequestId: string;
      headSha: string;
      conflictStatus: PrReviewConflictStatus;
      conflictCheckedAt: string | null;
    }
  ): Promise<PrReviewSessionRow> {
    const session = await transaction.queryOne<PrReviewSessionRow>(
      `
        INSERT INTO pr_review_sessions (
          room_id,
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
          $4,
          'analyzing',
          NULL,
          '[]'::jsonb,
          NULL,
          '[]'::jsonb,
          0,
          0,
          $5,
          $6
        )
        RETURNING
          id,
          room_id,
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
          analysis_error_code,
          analysis_error_message,
          created_at,
          updated_at
      `,
      [
        input.roomId,
        input.pullRequestId,
        input.currentUserId,
        input.headSha,
        input.conflictStatus,
        input.conflictCheckedAt
      ]
    );

    if (!session) {
      throw badRequest("Review session could not be created");
    }

    return session;
  }

  private async insertReviewAnalysisJob(
    transaction: DatabaseTransaction,
    input: {
      reviewSessionId: string;
      workspaceId: string;
      headSha: string;
    }
  ): Promise<{ id: string }> {
    const job = await transaction.queryOne<{ id: string }>(
      `
        INSERT INTO pr_review_analysis_jobs (
          review_session_id,
          workspace_id,
          head_sha
        )
        VALUES ($1, $2, $3)
        RETURNING id
      `,
      [input.reviewSessionId, input.workspaceId, input.headSha]
    );

    if (!job) {
      throw badRequest("PR Review analysis job could not be created");
    }

    return job;
  }

  private async insertReviewGraph(
    transaction: DatabaseTransaction,
    sessionId: string,
    roomId: string,
    files: PrReviewGithubChangedFile[],
    analysis: PrReviewAnalysisResult
  ): Promise<void> {
    const semanticGraph = analysis.semanticGraph;
    if (!semanticGraph) {
      throw badRequest("Validated semantic graph is required");
    }
    const graphFileByPath = new Map(
      semanticGraph.files.map((file) => [file.filePath, file])
    );
    const metadataByPath = new Map(
      analysis.files.map((file) => [file.filePath, file])
    );
    const reviewFileByPath = new Map<string, ReviewFileRow>();

    for (const file of files) {
      const metadata = metadataByPath.get(file.filePath);
      const graphFile = graphFileByPath.get(file.filePath);
      if (!metadata || !graphFile) {
        throw badRequest("Validated semantic graph files must match changed files");
      }
      const reviewFile = await this.insertReviewFile(
        transaction,
        sessionId,
        roomId,
        file,
        metadata,
        graphFile.roleType
      );
      reviewFileByPath.set(file.filePath, reviewFile);
    }

    const graphFlows =
      semanticGraph.flows.length > 0
        ? semanticGraph.flows
        : [
            {
              candidateKey: "empty-pr-fallback",
              title: analysis.flowTitle,
              description: "변경 파일이 없어 리뷰할 파일이 없습니다.",
              reviewOrder: []
            }
          ];
    const flowByKey = new Map<string, ReviewFlowRow>();
    const membershipIdByFlowAndPath = new Map<string, string>();
    const primaryMembershipByPath = new Map<
      string,
      {
        flowId: string;
        reviewFlowFileId: string;
        flowSortOrder: number;
        workflowOrder: number;
      }
    >();

    for (const [flowIndex, graphFlow] of graphFlows.entries()) {
      const flow = await transaction.queryOne<ReviewFlowRow>(
        `
          INSERT INTO review_flows (
            session_id,
            title,
            description,
            sort_order
          )
          VALUES ($1, $2, $3, $4)
          RETURNING id
        `,
        [
          sessionId,
          graphFlow.title,
          graphFlow.description,
          flowIndex + 1
        ]
      );

      if (!flow) {
        throw badRequest("Review flow could not be created");
      }
      flowByKey.set(graphFlow.candidateKey, flow);

      for (const [fileIndex, filePath] of graphFlow.reviewOrder.entries()) {
        const reviewFile = reviewFileByPath.get(filePath);
        if (!reviewFile) {
          throw badRequest("Review flow file must match a changed file");
        }
        const membership = await transaction.queryOne<{ id: string }>(
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
          [sessionId, flow.id, reviewFile.id, fileIndex + 1]
        );
        if (!membership) {
          throw badRequest("Review flow file could not be created");
        }
        membershipIdByFlowAndPath.set(
          this.semanticGraphMembershipKey(graphFlow.candidateKey, filePath),
          membership.id
        );
        if (!primaryMembershipByPath.has(filePath)) {
          primaryMembershipByPath.set(filePath, {
            flowId: flow.id,
            reviewFlowFileId: membership.id,
            flowSortOrder: flowIndex + 1,
            workflowOrder: fileIndex + 1
          });
        }
      }
    }

    for (const relation of semanticGraph.relations) {
      const flow = flowByKey.get(relation.flowKey);
      const fromMembershipId = membershipIdByFlowAndPath.get(
        this.semanticGraphMembershipKey(
          relation.flowKey,
          relation.fromFilePath
        )
      );
      const toMembershipId = membershipIdByFlowAndPath.get(
        this.semanticGraphMembershipKey(relation.flowKey, relation.toFilePath)
      );
      if (!flow || !fromMembershipId || !toMembershipId) {
        throw badRequest("Review flow relation must use files from the same flow");
      }

      const created = await transaction.queryOne<{ id: string }>(
        `
          INSERT INTO review_flow_relations (
            session_id,
            flow_id,
            from_review_flow_file_id,
            to_review_flow_file_id,
            relation_type,
            source,
            confidence,
            reason
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id
        `,
        [
          sessionId,
          flow.id,
          fromMembershipId,
          toMembershipId,
          relation.relationType,
          relation.source,
          relation.confidence,
          relation.reason
        ]
      );
      if (!created) {
        throw badRequest("Review flow relation could not be created");
      }
    }

    const materializationFiles: PrReviewCanvasMaterializationFile[] = files.map(
      (file, index) => {
        const reviewFile = reviewFileByPath.get(file.filePath);
        const metadata = metadataByPath.get(file.filePath);
        const membership = primaryMembershipByPath.get(file.filePath);
        if (!reviewFile || !metadata) {
          throw badRequest("Review canvas file must match a changed file");
        }

        return {
          reviewFileId: reviewFile.id,
          roomFileId: reviewFile.room_file_id,
          reviewFlowFileId: membership?.reviewFlowFileId ?? null,
          flowId: membership?.flowId ?? null,
          flowSortOrder: membership?.flowSortOrder ?? graphFlows.length + 1,
          workflowOrder: membership?.workflowOrder ?? index + 1,
          fileName: file.fileName,
          filePath: file.filePath,
          fileStatus: file.fileStatus,
          roleSummary: metadata.fileRole,
          riskLevel: metadata.riskLevel,
          reviewStatus: reviewFile.current_status
        };
      }
    );
    const materializationRelations = this.buildCanvasMaterializationRelations(
      semanticGraph,
      graphFlows,
      flowByKey,
      reviewFileByPath
    );

    await this.materializeReviewCanvas(
      transaction,
      roomId,
      sessionId,
      materializationFiles,
      materializationRelations
    );
  }

  private buildCanvasMaterializationRelations(
    semanticGraph: PrReviewValidatedSemanticGraph,
    graphFlows: PrReviewValidatedGraphFlow[],
    flowByKey: Map<string, ReviewFlowRow>,
    reviewFileByPath: Map<string, ReviewFileRow>
  ): PrReviewCanvasMaterializationRelation[] {
    const relations: PrReviewCanvasMaterializationRelation[] = [];
    const appendRelation = (input: {
      flowKey: string;
      fromFilePath: string;
      toFilePath: string;
      relationType: PrReviewCanvasMaterializationRelation["relationType"];
      source: PrReviewCanvasMaterializationRelation["source"];
      confidence: number;
      reason: string;
    }) => {
      const flow = flowByKey.get(input.flowKey);
      const fromFile = reviewFileByPath.get(input.fromFilePath);
      const toFile = reviewFileByPath.get(input.toFilePath);
      if (!flow || !fromFile || !toFile) {
        throw badRequest("Review canvas relation must match the review graph");
      }

      relations.push({
        fromReviewFileId: fromFile.id,
        toReviewFileId: toFile.id,
        fromRoomFileId: fromFile.room_file_id,
        toRoomFileId: toFile.room_file_id,
        flowId: flow.id,
        relationType: input.relationType,
        source: input.source,
        confidence: input.confidence,
        reason: input.reason
      });
    };

    for (const relation of semanticGraph.relations) {
      appendRelation(relation);
    }

    for (const graphFlow of graphFlows) {
      for (let index = 1; index < graphFlow.reviewOrder.length; index += 1) {
        appendRelation({
          flowKey: graphFlow.candidateKey,
          fromFilePath: graphFlow.reviewOrder[index - 1],
          toFilePath: graphFlow.reviewOrder[index],
          relationType: "review_order",
          source: "fallback",
          confidence: 100,
          reason: "추천 리뷰 경로"
        });
      }
    }

    return relations;
  }

  private async materializeReviewCanvas(
    transaction: DatabaseTransaction,
    roomId: string,
    sessionId: string,
    files: PrReviewCanvasMaterializationFile[],
    relations: PrReviewCanvasMaterializationRelation[]
  ): Promise<void> {
    const room = await transaction.queryOne<{ canvas_id: string }>(
      `
        SELECT canvas_id
        FROM pr_review_rooms
        WHERE id = $1
        FOR UPDATE
      `,
      [roomId]
    );
    if (!room) {
      throw conflictError("PR Review room is no longer active");
    }

    const existingShapes = await transaction.query<CanvasShapeRow>(
      `
        SELECT
          id,
          canvas_id,
          parent_shape_id,
          shape_type,
          title,
          text_content,
          x,
          y,
          width,
          height,
          rotation,
          z_index,
          raw_shape,
          content_hash,
          revision,
          created_at,
          updated_at,
          deleted_at
        FROM canvas_freeform_shapes
        WHERE canvas_id = $1
          AND shape_type = ANY($2::text[])
        ORDER BY id
        FOR UPDATE
      `,
      [
        room.canvas_id,
        [
          PR_REVIEW_FILE_NODE_SHAPE_TYPE,
          PR_REVIEW_RELATION_EDGE_SHAPE_TYPE
        ]
      ]
    );
    const materialization = buildPrReviewCanvasMaterialization({
      reviewRoomId: roomId,
      reviewSessionId: sessionId,
      files,
      relations,
      existingShapes
    });

    for (const shape of materialization.shapes) {
      const values = shape.values;
      const contentHash = computeShapeContentHash(values);
      await transaction.execute(
        `
          INSERT INTO canvas_freeform_shapes (
            id,
            canvas_id,
            parent_shape_id,
            shape_type,
            title,
            text_content,
            x,
            y,
            width,
            height,
            rotation,
            z_index,
            raw_shape,
            content_hash,
            deleted_at
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
            $13::jsonb,
            $14,
            NULL
          )
          ON CONFLICT (id) DO UPDATE
          SET
            parent_shape_id = EXCLUDED.parent_shape_id,
            shape_type = EXCLUDED.shape_type,
            title = EXCLUDED.title,
            text_content = EXCLUDED.text_content,
            x = EXCLUDED.x,
            y = EXCLUDED.y,
            width = EXCLUDED.width,
            height = EXCLUDED.height,
            rotation = EXCLUDED.rotation,
            z_index = EXCLUDED.z_index,
            raw_shape = EXCLUDED.raw_shape,
            content_hash = EXCLUDED.content_hash,
            revision = canvas_freeform_shapes.revision + 1,
            updated_at = NOW(),
            deleted_at = NULL
          WHERE canvas_freeform_shapes.canvas_id = EXCLUDED.canvas_id
            AND (
              canvas_freeform_shapes.deleted_at IS NOT NULL
              OR canvas_freeform_shapes.content_hash <> EXCLUDED.content_hash
            )
        `,
        [
          shape.id,
          room.canvas_id,
          values.parentShapeId,
          values.shapeType,
          values.title,
          values.textContent,
          values.x,
          values.y,
          values.width,
          values.height,
          values.rotation,
          values.zIndex,
          JSON.stringify(values.rawShape),
          contentHash
        ]
      );
    }

    await transaction.execute(
      `
        UPDATE canvas_freeform_shapes
        SET deleted_at = NOW(),
            revision = revision + 1,
            updated_at = NOW()
        WHERE canvas_id = $1
          AND shape_type = ANY($2::text[])
          AND deleted_at IS NULL
          AND NOT (id = ANY($3::text[]))
      `,
      [
        room.canvas_id,
        [
          PR_REVIEW_FILE_NODE_SHAPE_TYPE,
          PR_REVIEW_RELATION_EDGE_SHAPE_TYPE
        ],
        materialization.activeShapeIds
      ]
    );
    await transaction.execute(
      `
        UPDATE canvas
        SET updated_at = NOW()
        WHERE id = $1
      `,
      [room.canvas_id]
    );
  }

  private async insertReviewFile(
    transaction: DatabaseTransaction,
    sessionId: string,
    roomId: string,
    file: PrReviewGithubChangedFile,
    metadata: ReviewFileMetadata,
    roleType: PrReviewFileRoleType
  ): Promise<ReviewFileRow> {
    let roomFile: { id: string } | null = null;
    if (file.previousFilePath) {
      roomFile = await transaction.queryOne<{ id: string }>(
        `
          UPDATE pr_review_room_files
          SET current_file_path = $3
          WHERE room_id = $1
            AND current_file_path = $2
          RETURNING id
        `,
        [roomId, file.previousFilePath, file.filePath]
      );
    }
    roomFile ??= await transaction.queryOne<{ id: string }>(
      `
        INSERT INTO pr_review_room_files (room_id, current_file_path)
        VALUES ($1, $2)
        ON CONFLICT (room_id, current_file_path)
        DO UPDATE SET current_file_path = EXCLUDED.current_file_path
        RETURNING id
      `,
      [roomId, file.filePath]
    );
    if (!roomFile) {
      throw badRequest("PR Review room file could not be created");
    }

    const carryOver = await this.findReviewFileCarryOver(
      transaction,
      roomId,
      roomFile.id,
      file.headBlobSha
    );

    const reviewFile = await transaction.queryOne<ReviewFileRow>(
      `
        INSERT INTO review_files (
          session_id,
          room_id,
          room_file_id,
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
          role_type,
          risk_level,
          change_reason,
          change_summary,
          review_points,
          head_blob_sha,
          carried_from_decision_id,
          current_status,
          comment,
          reviewed_by_user_id,
          reviewed_at
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
          $15,
          $16,
          $17,
          $18::jsonb,
          $19,
          $20,
          $21,
          $22,
          $23,
          $24
        )
        RETURNING id, room_file_id, current_status
      `,
      [
        sessionId,
        roomId,
        roomFile.id,
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
        roleType,
        metadata.riskLevel,
        metadata.changeReason,
        metadata.changeSummary,
        JSON.stringify(metadata.reviewPoints),
        file.headBlobSha,
        carryOver?.source_decision_id ?? null,
        carryOver?.current_status ?? "not_reviewed",
        carryOver?.comment ?? null,
        carryOver?.reviewed_by_user_id ?? null,
        carryOver?.reviewed_at ?? null
      ]
    );

    if (!reviewFile) {
      throw badRequest("Review file could not be created");
    }

    return reviewFile;
  }

  private async findReviewFileCarryOver(
    transaction: DatabaseTransaction,
    roomId: string,
    roomFileId: string,
    headBlobSha: string | null
  ): Promise<ReviewFileCarryOverRow | null> {
    if (!headBlobSha) {
      return null;
    }

    return transaction.queryOne<ReviewFileCarryOverRow>(
      `
        SELECT
          COALESCE(
            latest_decision.id,
            previous_file.carried_from_decision_id
          ) AS source_decision_id,
          previous_file.current_status,
          previous_file.comment,
          previous_file.reviewed_by_user_id,
          previous_file.reviewed_at
        FROM pr_review_rooms AS review_room
        JOIN review_files AS previous_file
          ON previous_file.session_id = review_room.current_session_id
         AND previous_file.room_id = review_room.id
         AND previous_file.room_file_id = $2
        LEFT JOIN LATERAL (
          SELECT decision.id
          FROM file_review_decisions AS decision
          WHERE decision.review_file_id = previous_file.id
          ORDER BY decision.reviewed_at DESC, decision.id DESC
          LIMIT 1
        ) AS latest_decision ON true
        WHERE review_room.id = $1
          AND previous_file.head_blob_sha = $3
          AND previous_file.current_status <> 'not_reviewed'
          AND previous_file.reviewed_by_user_id IS NOT NULL
          AND previous_file.reviewed_at IS NOT NULL
          AND COALESCE(
            latest_decision.id,
            previous_file.carried_from_decision_id
          ) IS NOT NULL
      `,
      [roomId, roomFileId, headBlobSha]
    );
  }

  private semanticGraphMembershipKey(flowKey: string, filePath: string): string {
    return `${flowKey}\u0000${filePath}`;
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

  private mapConflictDraft(
    draft: PrReviewConflictDraftRow
  ): PrReviewConflictDraftPayload {
    return {
      reviewFileId: draft.review_file_id,
      sourceHeadBlobSha: draft.source_head_blob_sha,
      resolvedContent: draft.resolved_content,
      draftVersion: Number(draft.draft_version),
      updatedByUserId: draft.updated_by_user_id,
      updatedAt: new Date(draft.updated_at).toISOString()
    };
  }

  private async findConflictDraft(
    reviewFileId: string
  ): Promise<PrReviewConflictDraftPayload | null> {
    const draft = await this.database.queryOne<PrReviewConflictDraftRow>(
      `SELECT review_file_id,
              source_head_blob_sha,
              resolved_content,
              draft_version,
              updated_by_user_id,
              updated_at
       FROM pr_review_conflict_drafts
       WHERE review_file_id = $1`,
      [reviewFileId]
    );
    return draft ? this.mapConflictDraft(draft) : null;
  }

  private async deleteConflictDrafts(reviewFileIds: string[]): Promise<void> {
    if (!reviewFileIds.length) return;
    await this.database.query(
      `DELETE FROM pr_review_conflict_drafts
       WHERE review_file_id = ANY($1::uuid[])`,
      [reviewFileIds]
    );
  }

  private async clearConflictDraftsAfterApply(input: {
    workspaceId: string;
    session: PrReviewSessionRow;
    reviewFileIds: string[];
  }): Promise<void> {
    try {
      const room = await this.findReviewRoomById(
        input.workspaceId,
        input.session.room_id
      );
      await this.deleteConflictDrafts(input.reviewFileIds);
      if (!room) return;
      await this.conflictDraftRealtimePublisher?.publishDraftInvalidatedSafely({
        workspaceId: input.workspaceId,
        canvasId: room.canvas_id,
        reviewRoomId: input.session.room_id,
        reviewSessionId: input.session.id,
        reviewFileIds: input.reviewFileIds
      });
    } catch {
      this.logger.warn(
        `PR Review Conflict draft cleanup failed after GitHub apply review_session_id=${input.session.id}`
      );
    }
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
    expectedDecisionVersion: number;
  } {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw badRequest("Request body must be an object");
    }

    const draft = body as PrReviewFileDecisionDraft;
    if (
      typeof draft.expectedDecisionVersion !== "number" ||
      !Number.isSafeInteger(draft.expectedDecisionVersion) ||
      draft.expectedDecisionVersion < 0
    ) {
      throw badRequest("expectedDecisionVersion must be a non-negative integer");
    }

    if (
      typeof draft.status !== "string" ||
      !this.isReviewDecisionStatus(draft.status)
    ) {
      throw badRequest("status must be approved, discussion_needed, or unknown");
    }

    if (draft.comment === undefined || draft.comment === null) {
      return {
        status: draft.status,
        comment: null,
        expectedDecisionVersion: draft.expectedDecisionVersion
      };
    }

    if (typeof draft.comment !== "string") {
      throw badRequest("comment must be a string or null");
    }

    return {
      status: draft.status,
      comment: draft.comment,
      expectedDecisionVersion: draft.expectedDecisionVersion
    };
  }

  private normalizeConflictsApply(body: unknown): {
    expectedHeadSha: string;
    files: Array<{
      reviewFileId: string;
      resolvedContent: string;
      expectedHeadBlobSha: string;
    }>;
  } {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw badRequest("Request body must be an object");
    }

    const draft = body as PrReviewConflictsApplyDraft;
    if (
      typeof draft.expectedHeadSha !== "string" ||
      !draft.expectedHeadSha.trim()
    ) {
      throw badRequest("expectedHeadSha must not be empty");
    }
    if (!Array.isArray(draft.files) || draft.files.length === 0) {
      throw badRequest("files must be a non-empty array");
    }

    const files = draft.files.map((value, index) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw badRequest(`files[${index}] must be an object`);
      }

      const file = value as PrReviewConflictsApplyFileDraft;
      if (typeof file.reviewFileId !== "string" || !file.reviewFileId.trim()) {
        throw badRequest(`files[${index}].reviewFileId must not be empty`);
      }
      if (
        typeof file.expectedHeadBlobSha !== "string" ||
        !file.expectedHeadBlobSha.trim()
      ) {
        throw badRequest(
          `files[${index}].expectedHeadBlobSha must not be empty`
        );
      }

      return {
        reviewFileId: file.reviewFileId.trim(),
        resolvedContent: this.normalizeResolvedConflictContent(
          file.resolvedContent,
          `files[${index}].resolvedContent`
        ),
        expectedHeadBlobSha: file.expectedHeadBlobSha.trim()
      };
    });
    if (new Set(files.map((file) => file.reviewFileId)).size !== files.length) {
      throw badRequest("files must not contain duplicate reviewFileId values");
    }

    return {
      expectedHeadSha: draft.expectedHeadSha.trim(),
      files
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
    const resolvedContent = this.normalizeResolvedConflictContent(
      draft.resolvedContent,
      "resolvedContent"
    );

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

  private normalizeConflictDraftUpdate(body: unknown): {
    sourceHeadBlobSha: string;
    resolvedContent: string;
    expectedDraftVersion: number;
  } {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw badRequest("Request body must be an object");
    }
    const draft = body as PrReviewConflictDraftUpdateInput;
    if (
      typeof draft.sourceHeadBlobSha !== "string" ||
      !draft.sourceHeadBlobSha.trim() ||
      draft.sourceHeadBlobSha.trim().length > 255
    ) {
      throw badRequest("sourceHeadBlobSha must be a non-empty string");
    }
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
    if (
      typeof draft.expectedDraftVersion !== "number" ||
      !Number.isInteger(draft.expectedDraftVersion) ||
      draft.expectedDraftVersion < 0
    ) {
      throw badRequest("expectedDraftVersion must be a non-negative integer");
    }

    return {
      sourceHeadBlobSha: draft.sourceHeadBlobSha.trim(),
      resolvedContent,
      expectedDraftVersion: draft.expectedDraftVersion
    };
  }

  private normalizeConflictSuggestionCurrentDraft(
    body: unknown,
    hunks: PrReviewConflictHunkPayload[]
  ): PrReviewConflictSuggestionCurrentDraft | null {
    if (body === undefined || body === null) {
      return null;
    }
    if (typeof body !== "object" || Array.isArray(body)) {
      throw badRequest("Request body must be an object");
    }

    const draftInput = body as PrReviewConflictSuggestionDraftInput;
    if (draftInput.currentDraft === undefined) {
      return null;
    }
    if (
      !draftInput.currentDraft ||
      typeof draftInput.currentDraft !== "object" ||
      Array.isArray(draftInput.currentDraft)
    ) {
      throw badRequest("currentDraft must be an object");
    }

    const currentDraft =
      draftInput.currentDraft as PrReviewConflictSuggestionCurrentDraftInput;
    const resolvedContent = this.normalizeResolvedConflictContent(
      currentDraft.resolvedContent,
      "currentDraft.resolvedContent"
    );
    if (!Array.isArray(currentDraft.hunks)) {
      throw badRequest("currentDraft.hunks must be an array");
    }

    const conflictHunkIds = new Set(hunks.map((hunk) => hunk.id));
    const normalizedHunks = currentDraft.hunks.map((value, index) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw badRequest(`currentDraft.hunks[${index}] must be an object`);
      }

      const hunk = value as PrReviewConflictSuggestionHunkDraftInput;
      if (typeof hunk.hunkId !== "string" || !hunk.hunkId.trim()) {
        throw badRequest(
          `currentDraft.hunks[${index}].hunkId must not be empty`
        );
      }
      const hunkId = hunk.hunkId.trim();
      if (!conflictHunkIds.has(hunkId)) {
        throw badRequest(
          `currentDraft.hunks[${index}].hunkId is not a current conflict hunk`
        );
      }
      if (
        typeof hunk.source !== "string" ||
        !CONFLICT_SUGGESTION_DRAFT_SOURCES.includes(
          hunk.source as PrReviewConflictSuggestionDraftSource
        )
      ) {
        throw badRequest(
          `currentDraft.hunks[${index}].source is not supported`
        );
      }

      return {
        hunkId,
        source: hunk.source as PrReviewConflictSuggestionDraftSource,
        resolvedText: this.normalizeConflictSuggestionHunkText(
          hunk.resolvedText,
          `currentDraft.hunks[${index}].resolvedText`
        )
      };
    });

    if (
      new Set(normalizedHunks.map((hunk) => hunk.hunkId)).size !==
      normalizedHunks.length
    ) {
      throw badRequest("currentDraft.hunks must not contain duplicate hunkId values");
    }
    if (
      normalizedHunks.reduce(
        (total, hunk) => total + hunk.resolvedText.length,
        0
      ) > MAX_CONFLICT_APPLY_CONTENT_CHARS
    ) {
      throw badRequest("currentDraft.hunks resolvedText is too large");
    }

    return {
      resolvedContent,
      hunks: normalizedHunks
    };
  }

  private normalizeConflictSuggestionHunkText(
    value: unknown,
    field: string
  ): string {
    if (typeof value !== "string") {
      throw badRequest(`${field} must be a string`);
    }

    const resolvedText = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (resolvedText.length > MAX_CONFLICT_APPLY_CONTENT_CHARS) {
      throw badRequest(`${field} is too large`);
    }
    if (CONFLICT_MARKER_PATTERN.test(resolvedText)) {
      throw badRequest(`${field} must not contain conflict markers`);
    }

    return resolvedText;
  }

  private normalizeResolvedConflictContent(
    value: unknown,
    field: string
  ): string {
    if (typeof value !== "string") {
      throw badRequest(`${field} must be a string`);
    }

    const resolvedContent = value
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    if (!resolvedContent.trim()) {
      throw badRequest(`${field} must not be empty`);
    }
    if (resolvedContent.length > MAX_CONFLICT_APPLY_CONTENT_CHARS) {
      throw badRequest(`${field} is too large`);
    }
    if (CONFLICT_MARKER_PATTERN.test(resolvedContent)) {
      throw badRequest(`${field} must not contain conflict markers`);
    }

    return resolvedContent;
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

  private assertReviewSessionSubmitted(session: PrReviewSessionRow): void {
    if (session.status !== "submitted") {
      throw badRequest("GitHub Review must be submitted before merge");
    }
  }

  private assertReviewSessionMergeable(session: PrReviewSessionRow): void {
    this.assertReviewSessionSubmitted(session);

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
    flows: PrReviewCanvasFlowPayload[],
    semanticEdges: PrReviewCanvasEdgePayload[] = []
  ): PrReviewCanvasPayload {
    return {
      reviewSessionId: summary.id,
      headBranch: summary.head_branch,
      baseBranch: summary.base_branch,
      reviewedCount: Number(summary.reviewed_count),
      totalFileCount: Number(summary.total_file_count),
      conflictStatus: summary.conflict_status,
      flows,
      edges: this.buildCanvasEdges(flows, semanticEdges)
    };
  }

  private mapSession(session: PrReviewSessionRow): PrReviewSessionPayload {
    return {
      id: session.id,
      reviewRoomId: session.room_id,
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
      analysisError:
        session.analysis_error_code && session.analysis_error_message
          ? {
              code: session.analysis_error_code,
              message: session.analysis_error_message
            }
          : null,
      createdByUserId: session.created_by_user_id,
      createdAt: this.toIsoString(session.created_at),
      updatedAt: this.toIsoString(session.updated_at)
    };
  }

  private mapReviewRoom(room: PrReviewRoomRow): PrReviewRoomPayload {
    return {
      id: room.id,
      workspaceId: room.workspace_id,
      pullRequestId: room.pull_request_id,
      canvasId: room.canvas_id,
      currentReviewSessionId: room.current_session_id,
      analyzingReviewSessionId: room.analyzing_session_id,
      status: room.status,
      completionReason: room.completion_reason,
      completedAt: this.toNullableIsoString(room.completed_at),
      createdByUserId: room.created_by_user_id,
      createdAt: this.toIsoString(room.created_at),
      updatedAt: this.toIsoString(room.updated_at),
      pullRequest: {
        githubNumber: Number(room.pr_number),
        title: room.title,
        headBranch: room.head_branch,
        baseBranch: room.base_branch,
        githubUrl: room.html_url,
        state: room.pull_request_state === "closed" ? "closed" : "open",
        mergedAt: this.toNullableIsoString(room.pull_request_merged_at)
      },
      currentRevision:
        room.current_session_id &&
        room.current_head_sha &&
        room.current_session_status
          ? {
              reviewSessionId: room.current_session_id,
              headSha: room.current_head_sha,
              status: room.current_session_status
            }
          : null,
      revisionCount: Number(room.revision_count)
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
      roleType: file.role_type,
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
        roleType: file.role_type,
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
      roleType: file.role_type,
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
        roleType: file.role_type,
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
      roleType: file.role_type,
      riskLevel: this.normalizeRiskLevel(file.risk_level),
      changeReason: file.change_reason,
      changeSummary: file.change_summary,
      reviewPoints: this.toStringArray(file.review_points),
      currentStatus: file.current_status,
      comment: file.comment,
      reviewedByUserId: file.reviewed_by_user_id,
      reviewedAt: this.toNullableIsoString(file.reviewed_at),
      decisionVersion: Number(file.decision_version),
      decisionCarriedOver: file.carried_from_decision_id !== null,
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
    flows: PrReviewCanvasFlowPayload[],
    semanticEdges: PrReviewCanvasEdgePayload[] = []
  ): PrReviewCanvasEdgePayload[] {
    const edges: PrReviewCanvasEdgePayload[] = [];

    for (const flow of flows) {
      const flowSemanticEdges = semanticEdges.filter(
        (edge) => edge.flowId === flow.id
      );
      if (flowSemanticEdges.length > 0) {
        edges.push(...flowSemanticEdges);
        continue;
      }

      const files = [...flow.files].sort(
        (left, right) =>
          left.workflowOrder - right.workflowOrder ||
          left.reviewFileId.localeCompare(right.reviewFileId)
      );

      for (let index = 1; index < files.length; index += 1) {
        edges.push({
          id: `review-order:${flow.id}:${files[index - 1].id}:${files[index].id}`,
          fromReviewFileId: files[index - 1].reviewFileId,
          toReviewFileId: files[index].reviewFileId,
          fromReviewFlowFileId: files[index - 1].id,
          toReviewFlowFileId: files[index].id,
          flowId: flow.id,
          relationType: "review_order",
          reason: "리뷰 순서",
          source: "fallback",
          confidence: 100
        });
      }
    }

    return edges;
  }

  private mapFlowRelation(
    relation: ReviewFlowRelationRow
  ): PrReviewCanvasEdgePayload {
    return {
      id: relation.id,
      fromReviewFileId: relation.from_review_file_id,
      toReviewFileId: relation.to_review_file_id,
      fromReviewFlowFileId: relation.from_review_flow_file_id,
      toReviewFlowFileId: relation.to_review_flow_file_id,
      flowId: relation.flow_id,
      relationType: relation.relation_type,
      reason: relation.reason,
      source: relation.source,
      confidence: Number(relation.confidence)
    };
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
