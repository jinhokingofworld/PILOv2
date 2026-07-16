import type {
  BoardIssueCardPayload,
  BoardIssueDetailPayload,
  BoardRelatedPullRequestPayload
} from "../../board/types";
import type {
  AgentJsonObject,
  AgentJsonValue,
  AgentResourceRef
} from "../types/agent-tool.types";
import type {
  BoardContextCandidate,
  ResolvedBoardContext
} from "./board-context-resolver.service";

const MAX_TEXT_LENGTH = 160;
const MAX_BODY_LENGTH = 2_000;
const MAX_NAMED_VALUES = 10;
const MAX_PROJECT_FIELDS = 10;
const MAX_RELATED_PULL_REQUESTS = 5;

export function summarizeBoard(
  board: ResolvedBoardContext
): AgentJsonObject {
  return {
    name: boundText(board.name, 120),
    repository: boundText(board.repository.fullName, 160),
    project: boundText(board.project.title, 120)
  };
}

export function summarizeBoardCandidates(
  candidates: BoardContextCandidate[]
): AgentJsonObject[] {
  return candidates.map((candidate) => ({
    name: boundText(candidate.name, 120),
    repository: boundText(candidate.repositoryFullName, 160)
  }));
}

export function summarizeIssueCard(
  issue: BoardIssueCardPayload
): AgentJsonObject {
  return {
    issueNumber: boundText(issue.issueNumber, 40),
    title: boundText(issue.title, MAX_TEXT_LENGTH),
    state: issue.state ?? "unknown",
    labels: summarizeNamedValues(issue.labels, ["name"]),
    assignees: summarizeNamedValues(issue.assignees, ["login", "username"]),
    githubUpdatedAt: issue.githubUpdatedAt,
    lastSyncedAt: issue.lastSyncedAt
  };
}

export function summarizeIssueDetail(
  issue: BoardIssueDetailPayload
): AgentJsonObject {
  return {
    ...summarizeIssueCard(issue),
    body: issue.body ? boundText(issue.body, MAX_BODY_LENGTH) : null,
    milestone: summarizeMilestone(issue.milestone),
    projectFields: issue.projectFields
      .slice(0, MAX_PROJECT_FIELDS)
      .map((field) => compactJsonObject({
        name: boundText(field.fieldName, 120),
        type: field.fieldDataType,
        text: field.textValue,
        number: field.numberValue,
        date: field.dateValue,
        option: field.singleSelectName,
        iteration: field.iterationTitle
      }))
  };
}

export function summarizeRelatedPullRequests(
  pullRequests: BoardRelatedPullRequestPayload[]
): AgentJsonObject {
  return {
    source: "cached_heuristic",
    count: pullRequests.length,
    items: pullRequests.slice(0, MAX_RELATED_PULL_REQUESTS).map((pullRequest) => ({
      number: pullRequest.githubNumber,
      title: boundText(pullRequest.title, MAX_TEXT_LENGTH),
      state: pullRequest.state,
      draft: pullRequest.draft,
      author: pullRequest.authorName,
      updatedAt: pullRequest.updatedAtGithub,
      lastSyncedAt: pullRequest.lastSyncedAt
    }))
  };
}

export function issueResourceRef(
  issue: BoardIssueCardPayload,
  status?: string
): AgentResourceRef {
  return {
    domain: "board",
    resourceType: "issue",
    resourceId: issue.id,
    label: boundText(issue.title, MAX_TEXT_LENGTH),
    ...(issue.htmlUrl ? { url: issue.htmlUrl } : {}),
    status: status ?? issue.state ?? undefined,
    metadata: {
      issueNumber: issue.issueNumber
    }
  };
}

export function pullRequestResourceRefs(
  pullRequests: BoardRelatedPullRequestPayload[]
): AgentResourceRef[] {
  return pullRequests.slice(0, MAX_RELATED_PULL_REQUESTS).map((pullRequest) => ({
    domain: "board",
    resourceType: "pull_request",
    resourceId: pullRequest.id,
    label: boundText(pullRequest.title, MAX_TEXT_LENGTH),
    url: pullRequest.githubUrl,
    status: pullRequest.state,
    metadata: {
      number: pullRequest.githubNumber,
      relation: "cached_heuristic"
    }
  }));
}

export function readAssigneeLogins(values: unknown[]): string[] {
  return summarizeNamedValues(values, ["login", "username"]);
}

function summarizeNamedValues(values: unknown[], keys: string[]): string[] {
  return values
    .map((value) => readNamedValue(value, keys))
    .filter((value): value is string => value !== null)
    .slice(0, MAX_NAMED_VALUES);
}

function readNamedValue(value: unknown, keys: string[]): string | null {
  if (typeof value === "string" && value.trim()) {
    return boundText(value, 80);
  }
  if (!isPlainObject(value)) {
    return null;
  }
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return boundText(candidate, 80);
    }
  }
  return null;
}

function summarizeMilestone(
  milestone: Record<string, unknown> | null
): AgentJsonObject | null {
  if (!milestone) {
    return null;
  }
  return compactJsonObject({
    title:
      typeof milestone.title === "string"
        ? boundText(milestone.title, 120)
        : undefined,
    state: typeof milestone.state === "string" ? milestone.state : undefined,
    dueOn: typeof milestone.due_on === "string" ? milestone.due_on : undefined
  });
}

function compactJsonObject(
  input: Record<string, AgentJsonValue | undefined>
): AgentJsonObject {
  const output: AgentJsonObject = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      output[key] = value;
    }
  }
  return output;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundText(value: string, maxLength: number): string {
  const text = value.trim().replace(/\s+/g, " ");
  return text.length <= maxLength
    ? text
    : `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}
