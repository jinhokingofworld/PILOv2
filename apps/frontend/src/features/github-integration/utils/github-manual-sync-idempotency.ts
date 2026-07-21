import type { GithubSyncTarget } from "@/features/github-integration/types";

type GithubManualSyncScope = {
  installationId: string;
  repositoryId?: string;
  projectV2Id?: string;
  target: GithubSyncTarget;
};

type GithubManualSyncCompletion =
  | "success"
  | "transport_failure"
  | "rate_limited"
  | "definitive_failure";

function fingerprint(scope: GithubManualSyncScope): string {
  return JSON.stringify({
    installationId: scope.installationId,
    repositoryId: scope.repositoryId ?? null,
    projectV2Id: scope.projectV2Id ?? null,
    target: scope.target
  });
}

export function createGithubManualSyncIdempotency(
  createKey: () => string = () => crypto.randomUUID()
) {
  let pending: { fingerprint: string; key: string } | null = null;

  return {
    getKey(scope: GithubManualSyncScope): string {
      const scopeFingerprint = fingerprint(scope);
      if (!pending || pending.fingerprint !== scopeFingerprint) {
        pending = { fingerprint: scopeFingerprint, key: createKey() };
      }

      return pending.key;
    },
    complete(scope: GithubManualSyncScope, completion: GithubManualSyncCompletion): void {
      const scopeFingerprint = fingerprint(scope);
      if (
        pending?.fingerprint === scopeFingerprint &&
        completion !== "transport_failure" &&
        completion !== "rate_limited"
      ) {
        pending = null;
      }
    }
  };
}
