import { createHash } from "node:crypto";
import type { ActivityLogInput } from "../../common/activity-log.service";
import type { GithubIssueApiItem } from "../github-integration/github-app.client";
import type { BoardIssueState } from "./types";

interface BoardActivityLogContext {
  actorUserId: string;
  boardId: string;
  issueId: string;
  workspaceId: string;
}

interface BuildPiloIssueCreatedActivityLogInput
  extends BoardActivityLogContext {
  operationId: string;
}

interface BoardIssueUpdateSnapshot {
  assignees: unknown;
  body: string | null;
  state: BoardIssueState | null;
  title: string;
  updatedAt: Date | string;
}

interface BoardIssueRequestedChanges {
  assignees?: string[];
  body?: string;
  state?: BoardIssueState;
  title?: string;
}

interface BuildPiloIssueUpdatedActivityLogInput
  extends BoardActivityLogContext {
  after: GithubIssueApiItem;
  before: BoardIssueUpdateSnapshot;
  requestedChanges: BoardIssueRequestedChanges;
}

interface BuildPiloIssueMovedActivityLogInput extends BoardActivityLogContext {
  beforeUpdatedAt: Date | string;
  from: string;
  to: string;
}

type BoardIssueChangedField = keyof BoardIssueRequestedChanges;

const BOARD_ISSUE_CHANGED_FIELDS: BoardIssueChangedField[] = [
  "title",
  "body",
  "state",
  "assignees"
];

const BOARD_ISSUE_FIELD_LABELS: Record<BoardIssueChangedField, string> = {
  assignees: "담당자",
  body: "본문",
  state: "상태",
  title: "제목"
};

export function buildPiloIssueCreatedActivityLog(
  input: BuildPiloIssueCreatedActivityLogInput
): ActivityLogInput {
  return {
    workspaceId: input.workspaceId,
    actor: { type: "user", userId: input.actorUserId },
    action: "pilo_issue_created",
    target: { type: "pilo_issue", id: input.issueId },
    dedupeKey: `board:pilo_issue_created:${input.issueId}:${input.operationId}`,
    metadata: {
      version: 1,
      summary: "Board 이슈를 생성했습니다.",
      data: { boardId: input.boardId }
    }
  };
}

export function buildPiloIssueUpdatedActivityLog(
  input: BuildPiloIssueUpdatedActivityLogInput
): ActivityLogInput | null {
  const changedFields = BOARD_ISSUE_CHANGED_FIELDS.filter(
    (field) =>
      Object.hasOwn(input.requestedChanges, field) &&
      hasSemanticChange(field, input.before, input.after)
  );
  if (changedFields.length === 0) {
    return null;
  }

  const operationHash = hashOperation({
    beforeUpdatedAt: normalizeTimestamp(input.before.updatedAt),
    changedFields,
    after: Object.fromEntries(
      changedFields.map((field) => [field, semanticValue(field, input.after)])
    )
  });
  const changedFieldSummary = changedFields
    .map((field) => BOARD_ISSUE_FIELD_LABELS[field])
    .join(", ");

  return {
    workspaceId: input.workspaceId,
    actor: { type: "user", userId: input.actorUserId },
    action: "pilo_issue_updated",
    target: { type: "pilo_issue", id: input.issueId },
    dedupeKey: `board:pilo_issue_updated:${input.issueId}:${operationHash}`,
    metadata: {
      version: 1,
      summary: `Board 이슈의 ${changedFieldSummary}를 수정했습니다.`,
      data: {
        boardId: input.boardId,
        changedFields
      }
    }
  };
}

export function buildPiloIssueMovedActivityLog(
  input: BuildPiloIssueMovedActivityLogInput
): ActivityLogInput | null {
  if (input.from === input.to) {
    return null;
  }

  const operationHash = hashOperation({
    beforeUpdatedAt: normalizeTimestamp(input.beforeUpdatedAt),
    from: input.from,
    to: input.to
  });

  return {
    workspaceId: input.workspaceId,
    actor: { type: "user", userId: input.actorUserId },
    action: "pilo_issue_moved",
    target: { type: "pilo_issue", id: input.issueId },
    dedupeKey: `board:pilo_issue_moved:${input.issueId}:${operationHash}`,
    metadata: {
      version: 1,
      summary: "Board 이슈를 이동했습니다.",
      data: {
        boardId: input.boardId,
        from: input.from,
        to: input.to
      }
    }
  };
}

function hasSemanticChange(
  field: BoardIssueChangedField,
  before: BoardIssueUpdateSnapshot,
  after: GithubIssueApiItem
): boolean {
  if (field === "assignees") {
    return !arraysEqual(
      normalizeAssigneeLogins(before.assignees),
      normalizeAssigneeLogins(after.assignees)
    );
  }

  return (before[field] ?? null) !== (after[field] ?? null);
}

function semanticValue(
  field: BoardIssueChangedField,
  issue: GithubIssueApiItem
): string | string[] | null {
  return field === "assignees"
    ? normalizeAssigneeLogins(issue.assignees)
    : issue[field] ?? null;
}

function normalizeAssigneeLogins(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((assignee) => {
      if (!assignee || typeof assignee !== "object" || Array.isArray(assignee)) {
        return null;
      }

      const login = (assignee as { login?: unknown }).login;
      return typeof login === "string" ? login.toLowerCase() : null;
    })
    .filter((login): login is string => login !== null)
    .sort();
}

function arraysEqual(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function normalizeTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function hashOperation(value: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
