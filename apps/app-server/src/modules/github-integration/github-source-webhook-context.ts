export type GithubSourceWebhookEventName =
  | "issues"
  | "issue_comment"
  | "pull_request"
  | "pull_request_review"
  | "pull_request_review_comment";

export type GithubSourceWebhookKind = "issue" | "pull_request";

export interface GithubSourceWebhookContext {
  action: string;
  contentNumber: number;
  githubInstallationId: number;
  githubRepositoryId: number;
  kind: GithubSourceWebhookKind;
}

const SOURCE_WEBHOOK_EVENTS = new Set<GithubSourceWebhookEventName>([
  "issues",
  "issue_comment",
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function readEventName(value: string): GithubSourceWebhookEventName | null {
  return SOURCE_WEBHOOK_EVENTS.has(value as GithubSourceWebhookEventName)
    ? (value as GithubSourceWebhookEventName)
    : null;
}

export function isGithubSourceWebhookEventName(
  value: string
): value is GithubSourceWebhookEventName {
  return readEventName(value) !== null;
}

export function parseGithubSourceWebhookContext(
  eventNameValue: string,
  body: unknown
): GithubSourceWebhookContext | null {
  const eventName = readEventName(eventNameValue);
  if (!eventName || !isRecord(body)) {
    return null;
  }

  const action = typeof body.action === "string" ? body.action.trim() : "";
  const installation = isRecord(body.installation) ? body.installation : null;
  const repository = isRecord(body.repository) ? body.repository : null;
  const githubInstallationId = readPositiveInteger(installation?.id);
  const githubRepositoryId = readPositiveInteger(repository?.id);
  if (!action || !githubInstallationId || !githubRepositoryId) {
    return null;
  }

  if (eventName === "issues") {
    const issue = isRecord(body.issue) ? body.issue : null;
    const contentNumber = readPositiveInteger(issue?.number);
    if (!contentNumber || isRecord(issue?.pull_request)) {
      return null;
    }
    return {
      action,
      contentNumber,
      githubInstallationId,
      githubRepositoryId,
      kind: "issue"
    };
  }

  if (eventName === "issue_comment") {
    const issue = isRecord(body.issue) ? body.issue : null;
    const contentNumber = readPositiveInteger(issue?.number);
    if (!contentNumber || !isRecord(issue?.pull_request)) {
      return null;
    }
    return {
      action,
      contentNumber,
      githubInstallationId,
      githubRepositoryId,
      kind: "pull_request"
    };
  }

  const pullRequest = isRecord(body.pull_request) ? body.pull_request : null;
  const contentNumber = readPositiveInteger(pullRequest?.number);
  if (!contentNumber) {
    return null;
  }

  return {
    action,
    contentNumber,
    githubInstallationId,
    githubRepositoryId,
    kind: "pull_request"
  };
}
