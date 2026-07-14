export type GithubRepositoryOwnerType = "User" | "Organization";

export function readGithubRepositoryOwnerType(
  raw: unknown
): GithubRepositoryOwnerType | null {
  if (!isRecord(raw) || !isRecord(raw.owner)) {
    return null;
  }

  const ownerType = raw.owner.type;
  return ownerType === "User" || ownerType === "Organization"
    ? ownerType
    : null;
}

export function requiresPersonalProjectV2OAuth(
  repositoryOwnerType: GithubRepositoryOwnerType | null,
  installationAccountType: "User" | "Organization"
): boolean {
  return (
    repositoryOwnerType === "User" ||
    (repositoryOwnerType === null && installationAccountType === "User")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
