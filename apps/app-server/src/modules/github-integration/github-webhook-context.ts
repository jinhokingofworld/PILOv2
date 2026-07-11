export interface GithubProjectV2WebhookContext {
  action: string;
  githubInstallationId: number;
  projectV2NodeId: string;
  projectItemNodeId: string;
}

export function parseGithubProjectV2WebhookContext(
  body: unknown
): GithubProjectV2WebhookContext | null {
  if (!isRecord(body) || !isRecord(body.installation) || !isRecord(body.projects_v2_item)) {
    return null;
  }

  const action = toNonEmptyString(body.action);
  const githubInstallationId = body.installation.id;
  const projectV2NodeId = toNonEmptyString(body.projects_v2_item.project_node_id);
  const projectItemNodeId = toNonEmptyString(body.projects_v2_item.node_id);

  if (
    !action ||
    typeof githubInstallationId !== "number" ||
    !Number.isFinite(githubInstallationId) ||
    !projectV2NodeId ||
    !projectItemNodeId
  ) {
    return null;
  }

  return {
    action,
    githubInstallationId,
    projectV2NodeId,
    projectItemNodeId
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
