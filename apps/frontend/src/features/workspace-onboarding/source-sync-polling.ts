type GithubSourceSyncRun = {
  installationId: string | null;
  target: string;
  status: "queued" | "running" | "success" | "failed";
  errorMessage: string | null;
};

export type GithubSourceSyncPollingState =
  | { status: "polling" | "success" | "missing" }
  | { status: "failed"; errorMessage: string | null };

export function getGithubSourceSyncPollingState(
  runs: ReadonlyArray<GithubSourceSyncRun>,
  installationId: string
): GithubSourceSyncPollingState {
  const sourceRun = runs.find(
    (run) => run.installationId === installationId && run.target === "source"
  );

  if (!sourceRun) return { status: "missing" };
  if (sourceRun.status === "queued" || sourceRun.status === "running") {
    return { status: "polling" };
  }
  if (sourceRun.status === "failed") {
    return { status: "failed", errorMessage: sourceRun.errorMessage };
  }
  return { status: "success" };
}
