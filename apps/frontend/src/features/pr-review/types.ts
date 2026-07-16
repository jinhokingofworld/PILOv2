export type PrReviewPaginationMeta = {
  page: number;
  limit: number;
  total: number;
};

export type PrReviewPaginatedPayload<T> = {
  data: T[];
  meta: PrReviewPaginationMeta;
};

export type PrReviewRepository = {
  id: string;
  githubRepositoryId: number | null;
  githubNodeId: string | null;
  ownerLogin: string;
  name: string;
  fullName: string;
  private: boolean;
  archived: boolean;
  defaultBranch: string | null;
  htmlUrl: string;
  pushedAt: string | null;
  lastSyncedAt: string | null;
};

export type PrReviewPullRequest = {
  id: string;
  repositoryId: string;
  githubPullRequestId: number | null;
  githubNodeId: string | null;
  githubNumber: number;
  title: string;
  authorName: string | null;
  authorAvatarUrl: string | null;
  state: "open" | "closed";
  draft: boolean;
  mergeable: boolean | null;
  createdAtGithub: string | null;
  updatedAtGithub: string | null;
  headBranch: string | null;
  baseBranch: string | null;
  headSha: string | null;
  baseSha: string | null;
  changedFilesCount: number;
  additions: number;
  deletions: number;
  commitsCount: number;
  commentsCount: number;
  reviewCommentsCount: number;
  githubUrl: string;
  lastSyncedAt: string | null;
};

export type PrReviewPullRequestDetail = PrReviewPullRequest & {
  description: string | null;
  closedAtGithub: string | null;
  mergedAt: string | null;
};

export type PrReviewPullRequestFile = {
  filePath: string;
  previousFilePath: string | null;
  fileName: string;
  fileStatus: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  changes: number;
  isBinary: boolean;
  isLargeDiff: boolean;
  githubFileUrl: string;
  patch: string | null;
};

export type PrReviewFileStatus = PrReviewPullRequestFile["fileStatus"];

export type PrReviewSessionStatus =
  | "analyzing"
  | "reviewing"
  | "ready_to_submit"
  | "submitted"
  | "failed"
  | "archived";

export type PrReviewAnalysisErrorCode =
  | "ANALYSIS_ENQUEUE_FAILED"
  | "ANALYSIS_PROVIDER_FAILED"
  | "ANALYSIS_INPUT_INVALID"
  | "PR_HEAD_CHANGED";

export type PrReviewAnalysisError = {
  code: PrReviewAnalysisErrorCode;
  message: string;
};

export type PrReviewConflictStatus =
  | "checking"
  | "clean"
  | "conflicted"
  | "unknown";

export type PrReviewFileReviewStatus =
  | "not_reviewed"
  | "approved"
  | "discussion_needed"
  | "unknown";

export type PrReviewFileRiskLevel = "high" | "medium" | "low" | "unknown";

export type PrReviewFileRoleType =
  | "entry"
  | "core_logic"
  | "api_contract"
  | "ui_state"
  | "verification"
  | "support"
  | "unknown";

export type PrReviewRelationType =
  | "depends_on"
  | "tests"
  | "uses_api"
  | "passes_data_to"
  | "supports";

export type PrReviewRelationSource = "rule" | "ai" | "hybrid";

export type PrReviewFileDecisionStatus = Exclude<
  PrReviewFileReviewStatus,
  "not_reviewed"
>;

export type PrReviewDecisionUpdatedEvent = {
  event: "pr-review:decision:updated";
  workspaceId: string;
  canvasId: string;
  reviewRoomId: string;
  reviewSessionId: string;
  reviewFileId: string;
  roomFileId: string;
  currentStatus: PrReviewFileReviewStatus;
  decisionVersion: number;
  reviewedCount: number;
  totalFileCount: number;
  readyToSubmit: boolean;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
};

export type PrReviewRoomDeletedEvent = {
  event: "pr-review:room:deleted";
  workspaceId: string;
  canvasId: string;
  reviewRoomId: string;
};

export type PrReviewSubmitType = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

export type PrReviewGithubSubmitStatus =
  | "not_submitted"
  | "submitting"
  | "submitted"
  | "failed";

export type PrReviewSession = {
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
  analysisError: PrReviewAnalysisError | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PrReviewRoom = {
  id: string;
  workspaceId: string;
  pullRequestId: string;
  canvasId: string;
  currentReviewSessionId: string | null;
  analyzingReviewSessionId: string | null;
  status: "active" | "completed";
  completionReason: "merged" | "closed" | null;
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
};

export type PrReviewRoomList = {
  rooms: PrReviewRoom[];
};

export type PrReviewRoomStart = {
  room: PrReviewRoom;
  revision: PrReviewSession;
  roomCreated: boolean;
  revisionCreated: boolean;
};

export type PrReviewRoomCanvas = Pick<
  PrReviewRoom,
  "id" | "canvasId" | "currentReviewSessionId" | "status"
>;

export type PrReviewCanvasShape = {
  id: string;
  canvasId: string;
  parentShapeId: string | null;
  shapeType: string;
  title: string | null;
  textContent: string | null;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  rotation: number;
  zIndex: number;
  rawShape: Record<string, unknown>;
  contentHash: string;
  revision: number;
};

export type PrReviewCanvasViewportQuery = {
  x: number;
  y: number;
  width: number;
  height: number;
  margin?: number;
};

export type UpdatePrReviewCanvasFileShapeInput = {
  parentShapeId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  rawShape: Record<string, unknown>;
  baseRevision: number;
  clientOperationId: string;
};

export type PrReviewSummary = {
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
};

export type PrReviewFlow = {
  id: string;
  reviewSessionId: string;
  title: string;
  description: string | null;
  sortOrder: number;
  fileCount: number;
};

export type PrReviewFileNodeData = {
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
};

export type PrReviewFlowFile = {
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
  fileNodeData: PrReviewFileNodeData;
};

export type PrReviewCanvasFlow = PrReviewFlow & {
  files: PrReviewFlowFile[];
};

export type PrReviewCanvasEdge = {
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
};

export type PrReviewCanvas = {
  reviewSessionId: string;
  headBranch: string | null;
  baseBranch: string | null;
  reviewedCount: number;
  totalFileCount: number;
  conflictStatus: PrReviewConflictStatus;
  flows: PrReviewCanvasFlow[];
  edges: PrReviewCanvasEdge[];
};

export type PrReviewFileFlowMembership = {
  reviewFlowFileId: string;
  flowId: string;
  flowTitle: string;
  workflowOrder: number;
};

export type PrReviewLatestDecision = {
  id: string;
  status: PrReviewFileDecisionStatus;
  comment: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
};

export type PrReviewFile = {
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
  flowMemberships: PrReviewFileFlowMembership[];
  latestDecision: PrReviewLatestDecision | null;
};

export type PrReviewDiffMode = "side_by_side" | "binary" | "large";

export type PrReviewDiffRowType = "unchanged" | "added" | "deleted";

export type PrReviewDiffRow = {
  type: PrReviewDiffRowType;
  oldLineNumber: number | null;
  newLineNumber: number | null;
  oldText: string | null;
  newText: string | null;
};

export type PrReviewFileDiff = {
  reviewFileId: string;
  filePath: string;
  mode: PrReviewDiffMode;
  isBinary: boolean;
  isLargeDiff: boolean;
  githubFileUrl: string | null;
  message?: string;
  rows: PrReviewDiffRow[];
};

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

export type PrReviewConflictSuggestionStatus = "suggested" | "invalid";

export type PrReviewConflictHunk = {
  id: string;
  header: string;
  baseStartLine: number;
  baseLineCount: number;
  currentStartLine: number;
  currentLineCount: number;
  incomingStartLine: number;
  incomingLineCount: number;
  baseText: string;
  currentText: string;
  incomingText: string;
};

export type PrReviewConflictFile = {
  reviewFileId: string;
  filePath: string;
  previousFilePath: string | null;
  type: PrReviewConflictFileType;
  isSupported: true;
  resolutionStatus: PrReviewConflictResolutionStatus;
  headBlobSha: string;
  headContent: string;
  hunks: PrReviewConflictHunk[];
  aiSummary: string | null;
  aiSuggestion: string | null;
  resolvedContent: string | null;
};

export type PrReviewUnsupportedConflictFile = {
  reviewFileId: string;
  filePath: string;
  type: "unsupported";
  reason: string;
};

export type PrReviewConflictAnalysis = {
  reviewSessionId: string;
  pullRequestId: string;
  headSha: string;
  baseSha: string;
  conflictStatus: PrReviewConflictStatus;
  analysisMode: "sync";
  stored: false;
  supportedTypes: ["content"];
  files: PrReviewConflictFile[];
  unsupportedFiles: PrReviewUnsupportedConflictFile[];
};

export type PrReviewConflictSuggestion = {
  reviewFileId: string;
  filePath: string;
  previousFilePath: string | null;
  type: "content";
  status: PrReviewConflictSuggestionStatus;
  headSha: string;
  headBlobSha: string;
  aiSummary: string;
  aiSuggestion: string;
  resolvedHunks: PrReviewConflictResolvedHunk[];
  resolvedContent: string;
  validationMessages: string[];
  stored: false;
};

export type PrReviewConflictDraft = {
  reviewFileId: string;
  sourceHeadBlobSha: string;
  resolvedContent: string;
  resolutionState: PrReviewConflictDraftResolutionState;
  draftVersion: number;
  updatedByUserId: string;
  updatedAt: string;
};

export type UpdatePrReviewConflictDraftInput = {
  sourceHeadBlobSha: string;
  resolvedContent: string;
  resolutionState: PrReviewConflictDraftResolutionState;
  expectedDraftVersion: number;
};

export type PrReviewConflictResolvedHunk = {
  hunkId: string;
  resolvedText: string;
};

export type PrReviewConflictDraftSuggestion = {
  status: PrReviewConflictSuggestionStatus;
  aiSummary: string;
  aiSuggestion: string;
  resolvedHunks: PrReviewConflictResolvedHunk[];
  validationMessages: string[];
};

export type PrReviewConflictDraftSource =
  | "ai"
  | "pr"
  | "target"
  | "both"
  | "manual";

export type PrReviewConflictDraftResolutionState = {
  resolutionChoices: Record<string, PrReviewConflictDraftSource>;
  acceptedAiResolvedTexts: Record<string, string>;
  manualResolvedTexts: Record<string, string>;
  suggestion: PrReviewConflictDraftSuggestion | null;
  isCustomized: boolean;
};

export type CreatePrReviewConflictSuggestionInput = {
  currentDraft?: {
    resolvedContent: string;
    hunks: Array<{
      hunkId: string;
      source: PrReviewConflictDraftSource;
      resolvedText: string;
    }>;
  };
};

export type ApplyPrReviewConflictResolutionInput = {
  resolvedContent: string;
  expectedHeadSha: string;
  expectedHeadBlobSha: string;
};

export type ApplyPrReviewConflictsInput = {
  expectedHeadSha: string;
  files: Array<{
    reviewFileId: string;
    resolvedContent: string;
    expectedHeadBlobSha: string;
  }>;
};

export type PrReviewConflictApplyResult = {
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
};

export type PrReviewConflictsApplyFileResult = {
  reviewFileId: string;
  filePath: string;
  headBlobShaBefore: string;
  headBlobShaAfter: string;
};

export type PrReviewConflictsApplyResult = {
  reviewSessionId: string;
  pullRequestId: string;
  status: "applied";
  appliedByGithubLogin: string;
  commitSha: string;
  commitUrl: string | null;
  headShaBefore: string;
  headShaAfter: string;
  files: PrReviewConflictsApplyFileResult[];
  conflictStatus: PrReviewConflictStatus;
  conflictCheckedAt: string | null;
  localStateStatus: "updated" | "sync_required";
};

export type UpdatePrReviewFileDecisionInput = {
  status: PrReviewFileDecisionStatus;
  comment: string | null;
  expectedDecisionVersion: number;
};

export type PrReviewStatusCounts = {
  approved: number;
  discussionNeeded: number;
  unknown: number;
  notReviewed: number;
  total: number;
};

export type PrReviewSessionResultFile = {
  reviewFileId: string;
  fileName: string;
  filePath: string;
  status: PrReviewFileReviewStatus;
  comment: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
};

export type PrReviewSessionResult = {
  reviewSessionId: string;
  status: PrReviewSessionStatus;
  reviewResultSummary: string;
  counts: PrReviewStatusCounts;
  fileReviewResults: PrReviewSessionResultFile[];
  readyToSubmit: boolean;
};

export type PrReviewSubmissionFileResult = {
  fileName: string;
  filePath: string;
  status: PrReviewFileReviewStatus;
  comment: string | null;
};

export type PrReviewSubmissionListItem = {
  id: string;
  sessionId: string;
  submitType: PrReviewSubmitType;
  githubSubmitStatus: PrReviewGithubSubmitStatus;
  githubReviewId: string | null;
  githubReviewUrl: string | null;
  submittedByUserId: string | null;
  submittedByGithubLogin: string | null;
  errorMessage: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PrReviewSubmission = PrReviewSubmissionListItem & {
  reviewBody: string;
  reviewResultSummary: string | null;
  fileReviewResults: PrReviewSubmissionFileResult[];
};

export type SubmitPrReviewSessionInput = {
  submitType: PrReviewSubmitType;
  reviewBody: string;
};

export type MergePrReviewSessionInput = {
  expectedHeadSha: string;
  confirm: true;
};

export type PrReviewMergeResult = {
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
};

export type ListPrReviewRepositoriesQuery = {
  q?: string;
  includeArchived?: boolean;
  page?: number;
  limit?: number;
};

export type ListPrReviewPullRequestsQuery = {
  state?: "open" | "closed";
  query?: string;
  page?: number;
  limit?: number;
};
