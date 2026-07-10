import { Injectable } from "@nestjs/common";
import { QueryResultRow } from "pg";
import {
  DatabaseService,
  type DatabaseTransaction
} from "../../../database/database.service";
import type { GithubIssueApiItem } from "../../github-integration/github-app.client";
import { serializeGithubJsonb } from "../../github-integration/github-jsonb";

export type BoardIssueCreateOperationStatus =
  | "processing"
  | "retryable"
  | "succeeded";

export type BoardIssueCreateStage =
  | "none"
  | "github_issue_created"
  | "project_item_added"
  | "status_updated"
  | "cache_persisted";

export interface BoardIssueCreateOperationRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  actor_user_id: string;
  board_id: string;
  column_id: string;
  idempotency_key: string;
  request_hash: string;
  request_title: string;
  request_body: string | null;
  status: BoardIssueCreateOperationStatus;
  completed_stage: BoardIssueCreateStage;
  lease_token: string;
  locked_until: Date | string;
  github_issue_id: string | number | null;
  github_issue_node_id: string | null;
  github_issue_snapshot: unknown;
  github_project_item_node_id: string | null;
  pilo_issue_id: string | null;
  response_body: unknown;
  last_error_code: string | null;
  last_error_message: string | null;
  completed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface BoardIssueCreateOperationScope {
  workspaceId: string;
  actorUserId: string;
  idempotencyKey: string;
}

export interface InsertBoardIssueCreateOperationInput
  extends BoardIssueCreateOperationScope {
  boardId: string;
  columnId: string;
  requestHash: string;
  title: string;
  body?: string;
  leaseToken: string;
}

export interface BoardIssueCreateAttemptIdentity {
  operationId: string;
  leaseToken: string;
}

export interface SafeBoardIssueCreateOperationError {
  errorCode: string;
  errorMessage: string;
}

const OPERATION_COLUMNS = `
  id,
  workspace_id,
  actor_user_id,
  board_id::text AS board_id,
  column_id::text AS column_id,
  idempotency_key,
  request_hash,
  request_title,
  request_body,
  status,
  completed_stage,
  lease_token::text AS lease_token,
  locked_until,
  github_issue_id,
  github_issue_node_id,
  github_issue_snapshot,
  github_project_item_node_id,
  pilo_issue_id::text AS pilo_issue_id,
  response_body,
  last_error_code,
  last_error_message,
  completed_at,
  created_at,
  updated_at
`;

@Injectable()
export class BoardIssueCreateOperationQueries {
  constructor(private readonly database: DatabaseService) {}

  async transaction<T>(
    callback: (transaction: DatabaseTransaction) => Promise<T>
  ): Promise<T> {
    return this.database.transaction(callback);
  }

  async insertOperation(
    transaction: DatabaseTransaction,
    input: InsertBoardIssueCreateOperationInput
  ): Promise<BoardIssueCreateOperationRow | null> {
    return transaction.queryOne<BoardIssueCreateOperationRow>(
      `
        INSERT INTO board_issue_create_operations (
          workspace_id,
          actor_user_id,
          board_id,
          column_id,
          idempotency_key,
          request_hash,
          request_title,
          request_body,
          lease_token,
          locked_until
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          $3::bigint,
          $4::bigint,
          $5,
          $6,
          $7,
          $8,
          $9::uuid,
          now() + INTERVAL '5 minutes'
        )
        ON CONFLICT (workspace_id, actor_user_id, idempotency_key)
        DO NOTHING
        RETURNING ${OPERATION_COLUMNS}
      `,
      [
        input.workspaceId,
        input.actorUserId,
        input.boardId,
        input.columnId,
        input.idempotencyKey,
        input.requestHash,
        input.title,
        input.body ?? null,
        input.leaseToken
      ]
    );
  }

  async findOperationForUpdate(
    transaction: DatabaseTransaction,
    input: BoardIssueCreateOperationScope
  ): Promise<BoardIssueCreateOperationRow | null> {
    return transaction.queryOne<BoardIssueCreateOperationRow>(
      `
        SELECT ${OPERATION_COLUMNS}
        FROM board_issue_create_operations
        WHERE workspace_id = $1::uuid
          AND actor_user_id = $2::uuid
          AND idempotency_key = $3
        FOR UPDATE
      `,
      [input.workspaceId, input.actorUserId, input.idempotencyKey]
    );
  }

  async claimExistingOperation(
    transaction: DatabaseTransaction,
    input: {
      operationId: string;
      leaseToken: string;
    }
  ): Promise<BoardIssueCreateOperationRow | null> {
    return transaction.queryOne<BoardIssueCreateOperationRow>(
      `
        UPDATE board_issue_create_operations
        SET
          status = 'processing',
          lease_token = $2::uuid,
          locked_until = now() + INTERVAL '5 minutes',
          last_error_code = NULL,
          last_error_message = NULL,
          updated_at = now()
        WHERE id = $1::uuid
          AND (
            status = 'retryable'
            OR (status = 'processing' AND locked_until <= now())
          )
        RETURNING ${OPERATION_COLUMNS}
      `,
      [input.operationId, input.leaseToken]
    );
  }

  async saveGithubIssue(input: {
    operationId: string;
    leaseToken: string;
    issue: GithubIssueApiItem;
  }): Promise<BoardIssueCreateOperationRow | null> {
    return this.database.queryOne<BoardIssueCreateOperationRow>(
      `
        UPDATE board_issue_create_operations
        SET
          completed_stage = 'github_issue_created',
          github_issue_id = $3,
          github_issue_node_id = $4,
          github_issue_snapshot = $5::jsonb,
          locked_until = now() + INTERVAL '5 minutes',
          updated_at = now()
        WHERE id = $1::uuid
          AND lease_token = $2::uuid
          AND status = 'processing'
          AND completed_stage = 'none'
        RETURNING ${OPERATION_COLUMNS}
      `,
      [
        input.operationId,
        input.leaseToken,
        input.issue.id,
        input.issue.node_id,
        serializeGithubJsonb(input.issue)
      ]
    );
  }

  async saveProjectItem(input: {
    operationId: string;
    leaseToken: string;
    itemNodeId: string;
  }): Promise<BoardIssueCreateOperationRow | null> {
    return this.database.queryOne<BoardIssueCreateOperationRow>(
      `
        UPDATE board_issue_create_operations
        SET
          completed_stage = 'project_item_added',
          github_project_item_node_id = $3,
          locked_until = now() + INTERVAL '5 minutes',
          updated_at = now()
        WHERE id = $1::uuid
          AND lease_token = $2::uuid
          AND status = 'processing'
          AND completed_stage = 'github_issue_created'
        RETURNING ${OPERATION_COLUMNS}
      `,
      [input.operationId, input.leaseToken, input.itemNodeId]
    );
  }

  async saveStatusUpdated(
    input: BoardIssueCreateAttemptIdentity
  ): Promise<BoardIssueCreateOperationRow | null> {
    return this.database.queryOne<BoardIssueCreateOperationRow>(
      `
        UPDATE board_issue_create_operations
        SET
          completed_stage = 'status_updated',
          locked_until = now() + INTERVAL '5 minutes',
          updated_at = now()
        WHERE id = $1::uuid
          AND lease_token = $2::uuid
          AND status = 'processing'
          AND completed_stage = 'project_item_added'
        RETURNING ${OPERATION_COLUMNS}
      `,
      [input.operationId, input.leaseToken]
    );
  }

  async markRetryable(
    input: BoardIssueCreateAttemptIdentity & SafeBoardIssueCreateOperationError
  ): Promise<boolean> {
    const row = await this.database.queryOne<{ id: string }>(
      `
        UPDATE board_issue_create_operations
        SET
          status = 'retryable',
          last_error_code = $3,
          last_error_message = $4,
          updated_at = now()
        WHERE id = $1::uuid
          AND lease_token = $2::uuid
          AND status = 'processing'
        RETURNING id
      `,
      [input.operationId, input.leaseToken, input.errorCode, input.errorMessage]
    );

    return Boolean(row);
  }

  async markSucceeded(
    transaction: DatabaseTransaction,
    input: BoardIssueCreateAttemptIdentity & {
      piloIssueId: string;
      result: unknown;
    }
  ): Promise<boolean> {
    const row = await transaction.queryOne<{ id: string }>(
      `
        UPDATE board_issue_create_operations
        SET
          status = 'succeeded',
          completed_stage = 'cache_persisted',
          pilo_issue_id = $3::bigint,
          response_body = $4::jsonb,
          last_error_code = NULL,
          last_error_message = NULL,
          completed_at = now(),
          updated_at = now()
        WHERE id = $1::uuid
          AND lease_token = $2::uuid
          AND status = 'processing'
          AND completed_stage = 'status_updated'
        RETURNING id
      `,
      [
        input.operationId,
        input.leaseToken,
        input.piloIssueId,
        JSON.stringify(input.result)
      ]
    );

    return Boolean(row);
  }
}
