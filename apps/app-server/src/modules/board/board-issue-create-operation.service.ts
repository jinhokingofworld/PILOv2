import { HttpException, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { badRequest, conflict } from "../../common/api-error";
import type { DatabaseTransaction } from "../../database/database.service";
import type { GithubIssueApiItem } from "../github-integration/github-app.client";
import {
  BoardIssueCreateOperationQueries,
  type BoardIssueCreateOperationRow,
  type BoardIssueCreateStage
} from "./queries/board-issue-create-operation.queries";
import type { CreateBoardIssueResult } from "./board-issue-create.service";

export interface ClaimBoardIssueCreateInput {
  actorUserId: string;
  workspaceId: string;
  boardId: string;
  columnId: string;
  title: string;
  body?: string;
  idempotencyKey: unknown;
}

export interface BoardIssueCreateAttempt {
  operationId: string;
  leaseToken: string;
  completedStage: BoardIssueCreateStage;
  githubIssue: GithubIssueApiItem | null;
  githubProjectItemNodeId: string | null;
}

export type BoardIssueCreateClaim =
  | { kind: "execute"; attempt: BoardIssueCreateAttempt }
  | { kind: "replay"; result: CreateBoardIssueResult };

@Injectable()
export class BoardIssueCreateOperationService {
  constructor(private readonly queries: BoardIssueCreateOperationQueries) {}

  async claimOperation(
    input: ClaimBoardIssueCreateInput
  ): Promise<BoardIssueCreateClaim> {
    const idempotencyKey = this.readIdempotencyKey(input.idempotencyKey);
    const requestHash = this.hashRequest(input);

    return this.queries.transaction(async (transaction) => {
      const leaseToken = randomUUID();
      const inserted = await this.queries.insertOperation(transaction, {
        actorUserId: input.actorUserId,
        workspaceId: input.workspaceId,
        boardId: input.boardId,
        columnId: input.columnId,
        idempotencyKey,
        requestHash,
        title: input.title,
        body: input.body,
        leaseToken
      });

      if (inserted) {
        return {
          kind: "execute",
          attempt: this.mapAttempt(inserted)
        };
      }

      const existing = await this.queries.findOperationForUpdate(transaction, {
        actorUserId: input.actorUserId,
        workspaceId: input.workspaceId,
        idempotencyKey
      });

      if (!existing) {
        throw new Error("Board issue creation operation could not be claimed");
      }

      if (existing.request_hash !== requestHash) {
        throw conflict(
          "Idempotency-Key was already used for a different Board issue request"
        );
      }

      if (existing.status === "succeeded") {
        return {
          kind: "replay",
          result: this.readStoredResult(existing.response_body)
        };
      }

      if (existing.status === "processing" && !this.isLeaseExpired(existing)) {
        throw conflict("Board issue creation is already processing");
      }

      const claimed = await this.queries.claimExistingOperation(transaction, {
        operationId: existing.id,
        leaseToken
      });
      if (!claimed) {
        throw conflict("Board issue creation is already processing");
      }

      return {
        kind: "execute",
        attempt: this.mapAttempt(claimed)
      };
    });
  }

  async saveGithubIssue(
    attempt: BoardIssueCreateAttempt,
    issue: GithubIssueApiItem
  ): Promise<BoardIssueCreateAttempt> {
    const row = await this.queries.saveGithubIssue({
      operationId: attempt.operationId,
      leaseToken: attempt.leaseToken,
      issue
    });
    return this.requireActiveAttempt(row);
  }

  async saveProjectItem(
    attempt: BoardIssueCreateAttempt,
    itemNodeId: string
  ): Promise<BoardIssueCreateAttempt> {
    const row = await this.queries.saveProjectItem({
      operationId: attempt.operationId,
      leaseToken: attempt.leaseToken,
      itemNodeId
    });
    return this.requireActiveAttempt(row);
  }

  async saveStatusUpdated(
    attempt: BoardIssueCreateAttempt
  ): Promise<BoardIssueCreateAttempt> {
    const row = await this.queries.saveStatusUpdated({
      operationId: attempt.operationId,
      leaseToken: attempt.leaseToken
    });
    return this.requireActiveAttempt(row);
  }

  async markRetryableSafely(
    attempt: BoardIssueCreateAttempt,
    error: unknown
  ): Promise<void> {
    const safeError = this.readSafeError(error);
    try {
      await this.queries.markRetryable({
        operationId: attempt.operationId,
        leaseToken: attempt.leaseToken,
        ...safeError
      });
    } catch {
      // The original request error remains authoritative when checkpointing fails.
    }
  }

  async markSucceeded(
    transaction: DatabaseTransaction,
    input: {
      attempt: BoardIssueCreateAttempt;
      piloIssueId: string;
      result: CreateBoardIssueResult;
    }
  ): Promise<void> {
    const updated = await this.queries.markSucceeded(transaction, {
      operationId: input.attempt.operationId,
      leaseToken: input.attempt.leaseToken,
      piloIssueId: input.piloIssueId,
      result: input.result
    });

    if (!updated) {
      throw conflict("Board issue creation attempt is no longer active");
    }
  }

  private readIdempotencyKey(value: unknown): string {
    if (Array.isArray(value) || typeof value !== "string") {
      throw badRequest("Idempotency-Key is required");
    }

    const key = value.trim();
    if (!key) {
      throw badRequest("Idempotency-Key is required");
    }

    if (Buffer.byteLength(key, "utf8") > 128) {
      throw badRequest("Idempotency-Key must be 128 bytes or less");
    }

    return key;
  }

  private hashRequest(input: ClaimBoardIssueCreateInput): string {
    return createHash("sha256")
      .update(
        JSON.stringify({
          boardId: input.boardId,
          columnId: input.columnId,
          title: input.title,
          body: input.body ?? null
        })
      )
      .digest("hex");
  }

  private isLeaseExpired(row: BoardIssueCreateOperationRow): boolean {
    return new Date(row.locked_until).getTime() <= Date.now();
  }

  private requireActiveAttempt(
    row: BoardIssueCreateOperationRow | null
  ): BoardIssueCreateAttempt {
    if (!row) {
      throw conflict("Board issue creation attempt is no longer active");
    }

    return this.mapAttempt(row);
  }

  private mapAttempt(row: BoardIssueCreateOperationRow): BoardIssueCreateAttempt {
    return {
      operationId: row.id,
      leaseToken: row.lease_token,
      completedStage: row.completed_stage,
      githubIssue:
        row.completed_stage === "none"
          ? null
          : this.readGithubIssue(row.github_issue_snapshot),
      githubProjectItemNodeId: row.github_project_item_node_id
    };
  }

  private readGithubIssue(value: unknown): GithubIssueApiItem {
    const parsed = this.readJsonValue(value);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new Error("Board issue creation operation contains an invalid Issue snapshot");
    }

    const issue = parsed as Record<string, unknown>;
    if (
      typeof issue.id !== "number" ||
      typeof issue.node_id !== "string" ||
      typeof issue.number !== "number" ||
      typeof issue.title !== "string" ||
      (issue.state !== "open" && issue.state !== "closed") ||
      typeof issue.html_url !== "string"
    ) {
      throw new Error("Board issue creation operation contains an invalid Issue snapshot");
    }

    return issue as unknown as GithubIssueApiItem;
  }

  private readStoredResult(value: unknown): CreateBoardIssueResult {
    const parsed = this.readJsonValue(value);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      !("issue" in parsed) ||
      !parsed.issue ||
      typeof parsed.issue !== "object" ||
      Array.isArray(parsed.issue)
    ) {
      throw new Error("Board issue creation operation contains an invalid response");
    }

    return parsed as unknown as CreateBoardIssueResult;
  }

  private readJsonValue(value: unknown): unknown {
    if (typeof value !== "string") {
      return value;
    }

    try {
      return JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }

  private readSafeError(error: unknown): {
    errorCode: string;
    errorMessage: string;
  } {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      if (
        response &&
        typeof response === "object" &&
        !Array.isArray(response) &&
        "error" in response
      ) {
        const payload = (response as {
          error?: { code?: unknown; message?: unknown };
        }).error;
        if (
          typeof payload?.code === "string" &&
          typeof payload.message === "string"
        ) {
          return {
            errorCode: payload.code,
            errorMessage: payload.message
          };
        }
      }
    }

    return {
      errorCode: "INTERNAL_SERVER_ERROR",
      errorMessage: "Board issue creation failed"
    };
  }
}
