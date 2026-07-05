import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { badRequest, notFound } from "../../common/api-error";
import {
  DatabaseService,
  type DatabaseTransaction
} from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import { PrReviewGithubDependencyService } from "./pr-review-github-dependency.service";
import type {
  PrReviewConflictStatus,
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

interface ReviewFlowRow extends QueryResultRow {
  id: string;
}

interface ReviewFileRow extends QueryResultRow {
  id: string;
}

interface PrReviewSessionUpdateDraft {
  status?: unknown;
}

interface PrReviewAnalysis {
  prPurpose: string;
  changeSummary: string[];
  recommendedReviewOrder: string;
  cautionPoints: string[];
  flowTitle: string;
  flowDescription: string;
}

interface ReviewFileMetadata {
  fileRole: string;
  changeReason: string;
  changeSummary: string;
  reviewPoints: string[];
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

@Injectable()
export class PrReviewService {
  private readonly inFlightSessionCreations = new Set<string>();

  constructor(
    private readonly database: DatabaseService,
    private readonly workspaceService: WorkspaceService,
    private readonly githubDependency: PrReviewGithubDependencyService
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
      const analysis = this.analyzePullRequest(detail, files);

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

  private async insertReviewSession(
    transaction: DatabaseTransaction,
    input: {
      currentUserId: string;
      pullRequestId: string;
      detail: PrReviewGithubPullRequestDetail;
      files: PrReviewGithubChangedFile[];
      conflictStatus: PrReviewConflictStatus;
      conflictCheckedAt: string | null;
      analysis: PrReviewAnalysis;
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
    analysis: PrReviewAnalysis
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
      const metadata = this.buildFileMetadata(file, index);
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

  private analyzePullRequest(
    detail: PrReviewGithubPullRequestDetail,
    files: PrReviewGithubChangedFile[]
  ): PrReviewAnalysis {
    const totalAdditions = files.reduce((sum, file) => sum + file.additions, 0);
    const totalDeletions = files.reduce((sum, file) => sum + file.deletions, 0);
    const binaryCount = files.filter((file) => file.isBinary).length;
    const largeDiffCount = files.filter((file) => file.isLargeDiff).length;
    const cautionPoints = [
      ...(binaryCount > 0 ? [`Binary file ${binaryCount}개는 GitHub에서 확인한다.`] : []),
      ...(largeDiffCount > 0
        ? [`Large diff file ${largeDiffCount}개는 요약과 GitHub 원문을 함께 확인한다.`]
        : []),
      "제출 전 PR head SHA가 변경되지 않았는지 확인한다."
    ];

    return {
      prPurpose: `#${detail.prNumber} ${detail.title}`,
      changeSummary: [
        `${files.length}개 파일 변경`,
        `추가 ${totalAdditions}줄, 삭제 ${totalDeletions}줄`,
        `base ${detail.baseBranch ?? "unknown"} -> head ${detail.headBranch ?? "unknown"}`
      ],
      recommendedReviewOrder:
        files.length > 0
          ? "표시된 workflow order 순서대로 변경 범위가 큰 파일부터 확인한다."
          : "변경 파일이 없어 리뷰할 파일이 없다.",
      cautionPoints,
      flowTitle: "PR 변경 파일 리뷰",
      flowDescription:
        "PR Review MVP에서 생성한 기본 workflow다. 파일 metadata와 변경 규모를 기준으로 순서를 제공한다."
    };
  }

  private buildFileMetadata(
    file: PrReviewGithubChangedFile,
    index: number
  ): ReviewFileMetadata {
    return {
      fileRole: this.describeFileRole(file.filePath),
      changeReason: `${this.describeFileStatus(file.fileStatus)} 파일이다.`,
      changeSummary: `${file.additions}줄 추가, ${file.deletions}줄 삭제`,
      reviewPoints: [
        `Workflow order ${index + 1}번으로 확인한다.`,
        "변경 의도와 주변 호출부 영향이 일치하는지 확인한다.",
        "리뷰 판단을 approved, discussion_needed, unknown 중 하나로 남긴다."
      ]
    };
  }

  private describeFileRole(filePath: string): string {
    if (filePath.endsWith(".md")) {
      return "문서";
    }

    if (filePath.includes("/test") || filePath.includes(".test.")) {
      return "테스트";
    }

    if (filePath.includes("/src/app") || filePath.includes("/src/features")) {
      return "프론트엔드";
    }

    if (filePath.includes("/src/modules") || filePath.includes("app-server")) {
      return "백엔드";
    }

    return "일반 변경 파일";
  }

  private describeFileStatus(status: PrReviewFileStatus): string {
    switch (status) {
      case "added":
        return "추가된";
      case "deleted":
        return "삭제된";
      case "renamed":
        return "이름이 변경된";
      case "modified":
        return "수정된";
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

  private isSessionStatus(value: string): value is PrReviewSessionStatus {
    return SESSION_STATUSES.includes(value as PrReviewSessionStatus);
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
