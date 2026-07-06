import type {
  BoardIssueCardPayload,
  BoardIssueState
} from "@/features/board/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function formatBoardDateTime(value: string | null) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return [
    `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(
      date.getDate()
    ).padStart(2, "0")}`,
    `${String(date.getHours()).padStart(2, "0")}:${String(
      date.getMinutes()
    ).padStart(2, "0")}`
  ].join(" ");
}

export function formatBoardIssueNumber(issue: BoardIssueCardPayload) {
  if (issue.githubIssueNumber !== null) {
    return `#${issue.githubIssueNumber}`;
  }

  return issue.issueNumber ? `#${issue.issueNumber}` : "#-";
}

export function formatBoardIssueState(state: BoardIssueState | null) {
  if (state === "open") {
    return "Open";
  }

  if (state === "closed") {
    return "Closed";
  }

  return "Unknown";
}

export function readBoardLabelName(label: unknown) {
  if (typeof label === "string") {
    return label;
  }

  if (isRecord(label) && typeof label.name === "string") {
    return label.name;
  }

  return null;
}

export function readBoardLabelColor(label: unknown) {
  if (isRecord(label) && typeof label.color === "string") {
    return label.color.startsWith("#") ? label.color : `#${label.color}`;
  }

  return null;
}

export function readBoardAssigneeLogin(assignee: unknown) {
  if (typeof assignee === "string") {
    return assignee;
  }

  if (isRecord(assignee) && typeof assignee.login === "string") {
    return assignee.login;
  }

  if (isRecord(assignee) && typeof assignee.name === "string") {
    return assignee.name;
  }

  return null;
}

export function readBoardAssigneeAvatarUrl(assignee: unknown) {
  if (isRecord(assignee) && typeof assignee.avatarUrl === "string") {
    return assignee.avatarUrl;
  }

  if (isRecord(assignee) && typeof assignee.avatar_url === "string") {
    return assignee.avatar_url;
  }

  return null;
}
